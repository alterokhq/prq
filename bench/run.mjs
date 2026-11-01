#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, cp, rename } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cases, byId } from "./cases.mjs";
import { prepareBaseline, mutate } from "./fixture.mjs";
import { renderResults } from "./render.mjs";

const benchDir = dirname(fileURLToPath(import.meta.url));
const [operation = "help", ...args] = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
  if (!args[i].startsWith("--") || !args[i + 1] || args[i + 1].startsWith("--"))
    throw new Error(`Expected --name value, got ${args[i]}`);
  flags[args[i].slice(2)] = args[++i];
}
if (operation === "help") {
  console.log(
    "node bench/run.mjs prepare|controls|run --source <feedback-board> --fixtures-root <disposable-dir> [--case 07|all] [--ref <commit>] [--prq <built-cli>] [--browser <chromium-path>] [--results <json>] [--port-base 4300]",
  );
  process.exit(0);
}
if (!["prepare", "controls", "run"].includes(operation))
  throw new Error("Choose prepare, controls, or run.");
const root = resolve(flags["fixtures-root"] ?? "");
const source = resolve(flags.source ?? join(benchDir, "fixture"));
if (!flags["fixtures-root"] || root === source || root.startsWith(`${source}/`))
  throw new Error("Supply separate source and disposable fixtures directories.");
const snapshot = existsSync(join(source, ".prq-fixture.json"));
if (existsSync(join(root, ".stop"))) {
  console.log("Benchmark stop marker present; no case started.");
  process.exit(0);
}
const selected = flags.case && flags.case !== "all" ? [byId(flags.case)] : cases;
const resultsPath = resolve(flags.results ?? join(benchDir, "results.json"));
await mkdir(root, { recursive: true });
const marker = join(root, ".prq-benchmark-root");
if (!existsSync(marker))
  await writeFile(
    marker,
    "Disposable prq benchmark fixtures. No production deployment configuration is copied.\n",
    { flag: "wx" },
  );
let results = {
  version: 1,
  method:
    "Seeded defects on a single application. Authored tests, existing tests and independent oracles are reported separately.",
  cases: [],
};
if (existsSync(resultsPath)) results = JSON.parse(await readFile(resultsPath, "utf8"));

async function command(executable, argv, { cwd, env, timeout = 180000 } = {}) {
  const start = Date.now();
  return await new Promise((resolvePromise) => {
    const child = spawn(executable, argv, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      timedOut = false;
    child.stdout.on("data", (chunk) => {
      stdout = (stdout + chunk).slice(-2_000_000);
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-2_000_000);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeout);
    child.on("error", (issue) => {
      clearTimeout(timer);
      resolvePromise({
        exit_code: null,
        stdout,
        stderr: issue.message,
        duration_ms: Date.now() - start,
        timed_out: false,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({
        exit_code: code,
        stdout,
        stderr,
        duration_ms: Date.now() - start,
        timed_out: timedOut,
      });
    });
  });
}
async function git(cwd, argv) {
  const result = await command("git", argv, { cwd });
  if (result.exit_code !== 0)
    throw new Error(`Git command unavailable: ${result.stderr.slice(-1000)}`);
  return result.stdout.trim();
}
async function commit(cwd, message) {
  await git(cwd, ["add", "--all"]);
  await git(cwd, [
    "-c",
    "user.name=prq benchmark",
    "-c",
    "user.email=benchmark@localhost",
    "commit",
    "-m",
    message,
  ]);
  return await git(cwd, ["rev-parse", "HEAD"]);
}
async function save(row) {
  const index = results.cases.findIndex((item) => item.id === row.id);
  if (index < 0) results.cases.push(row);
  else results.cases[index] = row;
  results.cases.sort((a, b) => a.id.localeCompare(b.id));
  results.updated_at = new Date().toISOString();
  await mkdir(dirname(resultsPath), { recursive: true });
  const temporary = `${resultsPath}.tmp`;
  await writeFile(temporary, JSON.stringify(results, null, 2) + "\n");
  await rename(temporary, resultsPath);
  await writeFile(join(dirname(resultsPath), "index.html"), renderResults(results));
}
async function logResult(cwd, name, execution) {
  const logDir = join(cwd, "bench/runtime");
  await mkdir(logDir, { recursive: true });
  await writeFile(join(logDir, `${name}.log`), `${execution.stdout}\n${execution.stderr}`);
  return {
    outcome:
      execution.timed_out || execution.exit_code === null
        ? "unverified"
        : execution.exit_code === 0
          ? "held"
          : "broken",
    exit_code: execution.exit_code,
    duration_ms: execution.duration_ms,
    log: relative(root, join(logDir, `${name}.log`)),
  };
}
async function dependencies(cwd) {
  if (existsSync(join(cwd, "node_modules"))) return;
  if (!existsSync(join(source, "node_modules")))
    throw new Error("Install source fixture dependencies, including e2e, before running controls.");
  if (process.platform === "darwin") {
    const copied = await command(
      "cp",
      ["-cR", join(source, "node_modules"), join(cwd, "node_modules")],
      { timeout: 300000 },
    );
    if (copied.exit_code === 0) return;
    throw new Error("Copying dependencies into the disposable fixture did not complete.");
  }
  await cp(join(source, "node_modules"), join(cwd, "node_modules"), {
    recursive: true,
    verbatimSymlinks: true,
  });
}
async function controls(cwd, phase, existing) {
  const require = createRequire(join(cwd, "package.json"));
  const vitest = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");
  const run = async (name, files) =>
    logResult(
      cwd,
      `${phase}-${name}`,
      await command(process.execPath, [vitest, "run", ...files], {
        cwd,
        env: { NO_COLOR: "1" },
        timeout: 120000,
      }),
    );
  const record = {
    existing: await run("existing", existing),
    author: await run("author", ["convex/prq-author.test.ts"]),
  };
  if (existsSync(join(cwd, "convex/prq-oracle.test.ts")))
    record.oracle = await run("oracle", ["convex/prq-oracle.test.ts"]);
  return record;
}
async function runtime(cwd, seed, phase) {
  const { startApp, browserOracle } = await import("./runtime.mjs");
  const app = await startApp({ cwd, seed, phase, portBase: Number(flags["port-base"] ?? 4300) });
  try {
    const oracle = await browserOracle({ cwd, seed, phase, url: app.url, browser: flags.browser });
    return { oracle, app };
  } catch (issue) {
    await app.stop();
    throw issue;
  }
}

for (const seed of selected) {
  const cwd = join(root, `${seed.id}-${seed.slug}`);
  let row = results.cases.find((item) => item.id === seed.id) ?? {
    id: seed.id,
    slug: seed.slug,
    claim: seed.claim,
    setup: seed.setup,
    mutation: seed.mutation,
    phase: "prepared",
    baseline: null,
    seeded: null,
    prq: null,
    cost_usd: null,
    protocol: {
      node: process.version,
      browser_executor: "e2e LLM",
      browser_model: "gpt-6.1-sol",
      frontend: "Next dev (Turbopack)",
      convex_backend_requested: "precompiled-2026-10-22-1447815",
      port_base: Number(flags["port-base"] ?? 4300),
    },
  };
  try {
    if (!existsSync(join(cwd, ".git"))) {
      if (snapshot) {
        if (flags.ref) throw new Error("--ref applies to a Git source, not the bundled snapshot.");
        await cp(source, cwd, {
          recursive: true,
          filter: (file) =>
            !relative(source, file)
              .split("/")
              .some(
                (part) =>
                  ["node_modules", ".git", ".next", ".convex", ".pr", ".e2e"].includes(part) ||
                  part.startsWith(".env"),
              ),
        });
        await git(cwd, ["init", "--initial-branch=benchmark"]);
        await commit(cwd, "Import public benchmark fixture snapshot");
        row.source_snapshot = JSON.parse(await readFile(join(source, ".prq-fixture.json"), "utf8"));
      } else {
        await git(root, ["clone", "--local", "--no-hardlinks", "--no-checkout", source, cwd]);
        const ref = flags.ref ?? "22dd61e";
        await git(cwd, ["checkout", "--detach", ref]);
      }
      row.source_commit = await git(cwd, ["rev-parse", "HEAD"]);
      row.existing_test_files = (await git(cwd, ["ls-files"]))
        .split("\n")
        .filter((file) => /\.test\.[cm]?[jt]sx?$/.test(file));
      await prepareBaseline(cwd, seed);
      row.baseline_commit = await commit(cwd, `Prepare correct baseline for benchmark ${seed.id}`);
      row.phase = "prepared";
      await save(row);
    } else if (!row.baseline_commit)
      throw new Error(
        "Existing directory has no matching benchmark record. Use a fresh fixtures root.",
      );
    if (operation === "prepare") {
      console.log(`${seed.id} prepared`);
      continue;
    }
    await dependencies(cwd);
    const current = await git(cwd, ["rev-parse", "HEAD"]);
    if (current !== row.baseline_commit)
      throw new Error(
        "Case already mutated. Use a fresh fixtures root and results file for a new measured run.",
      );
    row.baseline = await controls(cwd, "baseline", row.existing_test_files);
    if (operation === "run") {
      const { oracle, app } = await runtime(cwd, seed, "baseline");
      row.baseline.browser = oracle;
      await app.stop();
      if (oracle.outcome !== "held") {
        row.phase = "baseline_unverified";
        row.note = "The correct baseline was not established. No planted-bug result is claimed.";
        await save(row);
        continue;
      }
    }
    await mutate(cwd, seed);
    // Only the explicit mutation is committed; local runtime configuration stays ignored.
    await git(cwd, [
      "add",
      seed.id === "08"
        ? "app/voter.ts"
        : ["02", "09", "12"].includes(seed.id)
          ? "app/page.tsx"
          : "convex/suggestions.ts",
    ]);
    await git(cwd, [
      "-c",
      "user.name=prq benchmark",
      "-c",
      "user.email=benchmark@localhost",
      "commit",
      "-m",
      `Plant benchmark ${seed.id} defect`,
    ]);
    row.seeded_commit = await git(cwd, ["rev-parse", "HEAD"]);
    await writeFile(
      join(cwd, "bench/runtime/mutation.patch"),
      (await command("git", ["diff", row.baseline_commit, row.seeded_commit], { cwd })).stdout,
    );
    row.seeded = await controls(cwd, "seeded", row.existing_test_files);
    row.existing_detected =
      row.baseline.existing.outcome === "held" ? row.seeded.existing.outcome === "broken" : null;
    row.author_detected =
      row.baseline.author.outcome === "held" ? row.seeded.author.outcome === "broken" : null;
    row.mutation_confirmed =
      row.baseline.oracle?.outcome === "held" && row.seeded.oracle?.outcome === "broken";
    row.phase = "controls_recorded";
    if (operation === "run") {
      const { oracle, app } = await runtime(cwd, seed, "seeded");
      row.seeded.browser = oracle;
      try {
        row.mutation_confirmed =
          row.baseline.browser.outcome === "held" && oracle.outcome === "broken";
        if (!row.mutation_confirmed) {
          row.note =
            "The browser oracle did not establish the intended contradiction; no caught-bug metric is counted.";
        } else if (flags.prq) {
          await app.reset();
          const cliHash = createHash("sha256")
            .update(await readFile(resolve(flags.prq)))
            .digest("hex");
          const start = Date.now();
          const execution = await command(
            process.execPath,
            [
              resolve(flags.prq),
              "--claims",
              "bench/done.md",
              "--json",
              "--quiet",
              "--no-open",
              "--app-url",
              app.url,
              "--timeout",
              "180000",
            ],
            { cwd, timeout: 600000 },
          );
          row.prq = await logResult(cwd, "prq", execution);
          // CLI exit 2 describes unresolved claims, not whether this target was detected.
          delete row.prq.outcome;
          row.prq.cli_sha256 = cliHash;
          row.phase = "prq_unverified";
          const last = join(cwd, ".pr/last.json");
          if (existsSync(last)) {
            const proof = JSON.parse(await readFile(last, "utf8"));
            const target = proof.claims.find((claim) => claim.text === seed.claim);
            if (Date.parse(proof.created_at) >= start && target) {
              row.prq.verdict = target.verdict;
              row.phase = "prq_recorded";
              row.prq.observed = target.observed;
              row.prq.judge = target.judge;
              row.prq.tester = target.tester;
              row.prq.report = relative(
                root,
                join(cwd, ".pr/runs", proof.id, "proof-request.json"),
              );
              row.prq.claim_text = target.text;
              row.prq.lock = proof.source.hash;
              row.cost_usd =
                typeof proof.timing?.cost_usd === "number" ? proof.timing.cost_usd : null;
            } else row.prq.note = "No fresh report with the exact target claim was found.";
          } else
            row.prq.note =
              "The CLI returned without saving a full Proof Request. This attempt remains unverified.";
        }
      } finally {
        await app.stop();
      }
    }
    await save(row);
    console.log(`${seed.id} ${row.phase}${row.prq?.verdict ? ` · ${row.prq.verdict}` : ""}`);
  } catch (issue) {
    row.note = issue instanceof Error ? issue.message : String(issue);
    row.phase = "unverified";
    await save(row);
    console.log(`${seed.id} unverified: ${row.note}`);
  }
}
