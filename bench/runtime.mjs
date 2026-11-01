import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function requireFreePort(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", () =>
      reject(
        new Error(
          `Local port ${port} is unavailable. Choose another --port-base; no existing process was stopped.`,
        ),
      ),
    );
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => server.close(resolve));
  });
}
async function until(check, timeout = 90000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      if (await check()) return true;
    } catch {}
    await delay(200);
  }
  return false;
}
function localEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (key.startsWith("CONVEX_") || key.startsWith("NEXT_PUBLIC_CONVEX_")) delete env[key];
  return {
    ...env,
    CONVEX_AGENT_MODE: "anonymous",
    CONVEX_DISABLE_TELEMETRY: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    NO_COLOR: "1",
  };
}
function start(executable, args, { cwd, env, log }) {
  const stream = createWriteStream(log, { flags: "a" });
  const child = spawn(executable, args, {
    cwd,
    env,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(stream);
  child.stderr.pipe(stream);
  child.on("error", (issue) => stream.write(`${issue.message}\n`));
  return {
    child,
    async stop() {
      try {
        if (child.pid) {
          if (process.platform === "win32") child.kill("SIGTERM");
          else process.kill(-child.pid, "SIGTERM");
        }
      } catch {}
      await delay(250);
      stream.end();
    },
  };
}
async function run(executable, args, { cwd, env, timeout = 60000 }) {
  return await new Promise((resolve) => {
    const child = spawn(executable, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output = (output + chunk).slice(-20000);
    });
    child.stderr.on("data", (chunk) => {
      output = (output + chunk).slice(-20000);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.on("error", (issue) => {
      clearTimeout(timer);
      resolve({ code: null, output: issue.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

export async function startApp({ cwd, seed, phase, portBase }) {
  if (!Number.isSafeInteger(portBase) || portBase < 4000 || portBase > 60000)
    throw new Error("Use a port base between 4000 and 60000.");
  const port = portBase + Number(seed.id) * 10;
  const backendPort = port + 1,
    sitePort = port + 2;
  for (const target of [port, backendPort, sitePort]) await requireFreePort(target);
  const require = createRequire(join(cwd, "package.json"));
  const convex = join(dirname(require.resolve("convex/package.json")), "bin/main.js");
  const next = join(dirname(require.resolve("next/package.json")), "dist/bin/next");
  const logDir = join(cwd, "bench/runtime");
  await mkdir(logDir, { recursive: true });
  const env = localEnv();
  const backend = start(
    process.execPath,
    [
      convex,
      "dev",
      "--typecheck",
      "disable",
      "--tail-logs",
      "disable",
      "--local-cloud-port",
      String(backendPort),
      "--local-site-port",
      String(sitePort),
      "--local-backend-version",
      "precompiled-2026-10-22-1447815",
    ],
    { cwd, env, log: join(logDir, `${phase}-backend.log`) },
  );
  let frontend;
  const stop = async () => {
    if (frontend) await frontend.stop();
    await backend.stop();
  };
  const onExit = () => {
    void stop();
  };
  process.once("SIGINT", onExit);
  process.once("SIGTERM", onExit);
  const reset = async () => {
    const result = await run(
      process.execPath,
      [convex, "run", "bench:reset", "{}", "--typecheck", "disable"],
      { cwd, env },
    );
    await writeFile(join(logDir, `${phase}-reset.log`), result.output);
    if (result.code !== 0)
      throw new Error("Local fixture reset did not complete. Inspect the private runtime log.");
  };
  try {
    const ready = await until(async () => {
      if (backend.child.exitCode !== null) return true;
      const text = await readFile(join(cwd, ".env.local"), "utf8");
      if (!text.includes(`127.0.0.1:${backendPort}`) && !text.includes(`localhost:${backendPort}`))
        return false;
      const response = await fetch(`http://127.0.0.1:${backendPort}/api/query`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: "suggestions:list", args: {}, format: "json" }),
        signal: AbortSignal.timeout(1000),
      });
      const result = await response.json();
      return result.status === "success";
    });
    if (!ready || backend.child.exitCode !== null)
      throw new Error(
        "Isolated local Convex backend did not become ready. No shared deployment was used.",
      );
    await reset();
    const frontendEnv = { ...env, NEXT_PUBLIC_CONVEX_URL: `http://127.0.0.1:${backendPort}` };
    frontend = start(
      process.execPath,
      [next, "dev", "--hostname", "127.0.0.1", "--port", String(port)],
      { cwd, env: frontendEnv, log: join(logDir, `${phase}-frontend.log`) },
    );
    const url = `http://127.0.0.1:${port}`;
    if (!(await until(async () => (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok)))
      throw new Error("Isolated Next application did not become ready.");
    return {
      url,
      reset,
      async stop() {
        process.removeListener("SIGINT", onExit);
        process.removeListener("SIGTERM", onExit);
        await stop();
      },
    };
  } catch (issue) {
    process.removeListener("SIGINT", onExit);
    process.removeListener("SIGTERM", onExit);
    await stop();
    throw issue;
  }
}

export async function browserOracle({ cwd, seed, phase, url, browser: browserPath }) {
  const started = Date.now();
  const require = createRequire(join(cwd, "package.json"));
  const webRequire = createRequire(require.resolve("@e2e-dev/web"));
  const playwright = await import(pathToFileURL(webRequire.resolve("playwright-core")).href);
  const chromium = playwright.chromium ?? playwright.default.chromium;
  const browser = await chromium.launch({
    headless: true,
    ...(browserPath ? { executablePath: browserPath } : {}),
  });
  const page = await browser.newPage();
  const file = join(cwd, "bench/runtime", `${phase}-oracle.png`);
  let outcome = "unverified",
    observation = "";
  const row = (title) => page.locator("li").filter({ has: page.getByText(title, { exact: true }) });
  const vote = (title) => row(title).getByRole("button");
  const hasCount = async (title, count) =>
    await until(
      async () => (await vote(title).getAttribute("aria-label")) === `${count} votes`,
      5000,
    );
  try {
    await page.goto(url);
    await page.locator("li").first().waitFor();
    await until(async () => await vote("Dark mode").isEnabled(), 5000);
    await delay(700);
    switch (seed.id) {
      case "01":
        await vote("Dark mode").click();
        assert(await hasCount("Dark mode", 1), "first vote should count once");
        await vote("Dark mode").click();
        assert(await hasCount("Dark mode", 0), "second click should remove vote");
        break;
      case "02":
        await vote("Rejected vote").click();
        await page.getByRole("status").filter({ hasText: "Voting failed" }).waitFor();
        assert(await hasCount("Rejected vote", 0), "a rejected request must not change the count");
        break;
      case "03":
        assert.equal(
          await vote("Dark mode").getAttribute("aria-pressed"),
          "false",
          "a fresh browser must not inherit another browser vote",
        );
        break;
      case "04":
        await vote("Dark mode").click();
        assert(await hasCount("Dark mode", 1));
        await vote("Dark mode").click();
        assert(
          await until(
            async () => (await page.getByRole("status").innerText()).includes("Already voted"),
            5000,
          ),
          "the duplicate request must be rejected",
        );
        assert(await hasCount("Dark mode", 1));
        break;
      case "05":
        await page.getByRole("button", { name: "Suggest", exact: true }).click();
        assert(
          await until(
            async () => (await page.getByRole("status").innerText()).includes("needs a title"),
            5000,
          ),
          "empty title must produce a rejection message",
        );
        break;
      case "06":
        assert.equal(
          await page.locator("li").first().getAttribute("data-title"),
          "Most requested",
          "highest vote count must appear first",
        );
        break;
      case "07":
        assert(await hasCount("Dark mode", 0), "suggestions without votes must display zero");
        break;
      case "08":
        await vote("Dark mode").click();
        assert(await hasCount("Dark mode", 1));
        await page.reload();
        await page.locator("li").first().waitFor();
        await delay(700);
        assert.equal(
          await vote("Dark mode").getAttribute("aria-pressed"),
          "true",
          "the same browser vote must remain selected after reload",
        );
        break;
      case "09":
        await vote("Rejected vote").click();
        assert(
          await until(
            async () => (await page.getByRole("status").innerText()).includes("Voting failed"),
            5000,
          ),
          "request rejection must produce an error message",
        );
        break;
      case "10":
        await page.getByLabel("Suggest a feature").fill("  Dark mode  ");
        await page.getByRole("button", { name: "Suggest", exact: true }).click();
        assert(
          await until(
            async () => (await page.getByRole("status").innerText()).includes("Duplicate"),
            5000,
          ),
          "normalized duplicate title must be rejected",
        );
        break;
      case "11":
        assert.equal(
          await page.locator("li").count(),
          12,
          "all seeded suggestions must be visible",
        );
        break;
      case "12":
        await vote("Slow vote").click();
        await delay(80);
        assert(await vote("Slow vote").isDisabled(), "vote button must be disabled during request");
        break;
      default:
        throw new Error("Missing browser oracle");
    }
    outcome = "held";
    observation = seed.oracle;
  } catch (issue) {
    outcome = issue instanceof assert.AssertionError ? "broken" : "unverified";
    observation = issue instanceof Error ? issue.message : String(issue);
  }
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  await browser.close();
  return {
    outcome,
    observation,
    duration_ms: Date.now() - started,
    screenshot: `${seed.id}-${seed.slug}/bench/runtime/${phase}-oracle.png`,
  };
}
