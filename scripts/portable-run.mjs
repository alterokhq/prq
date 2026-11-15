import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { boundedProcess } from "./portable-process.mjs";

const allowedEnvironment = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SystemRoot",
  "COMSPEC",
  "SHELL",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "PRQ_PROVIDER",
  "PRQ_MODEL",
  "PRQ_JUDGE_MODEL",
  "PRQ_DECISION_MODE",
  "PRQ_APP_URL",
  "E2E_TELEMETRY_DISABLED",
];

/** Transport adapter only. PRQ owns the lock, evidence and strict exit policy. */
export async function portableRun({
  cli,
  cwd,
  report,
  expectedHead,
  location = "local",
  executor = "cli",
  timeout = 1_800_000,
  output,
  env = process.env,
}) {
  if (!/^[0-9a-f]{40}$/.test(expectedHead)) throw new Error("Supply the full expected commit SHA.");
  if (
    !["local", "ci"].includes(location) ||
    !["cli", "dagger", "github_actions"].includes(executor)
  )
    throw new Error("Invalid execution context.");
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 3_600_000)
    throw new Error("Use an outer timeout between 100 and 3600000 milliseconds.");
  cwd = await realpath(resolve(cwd));
  cli = resolve(cli);
  report = resolve(report);
  const clean = Object.fromEntries(
    allowedEnvironment.flatMap((key) => (env[key] ? [[key, env[key]]] : [])),
  );
  const git = (args) => {
    const result = spawnSync("git", args, { cwd, env: clean, encoding: "utf8", timeout: 10_000 });
    if (result.status !== 0) throw new Error("Cannot inspect the checked-out source.");
    return result.stdout.trim();
  };
  if (git(["rev-parse", "HEAD"]) !== expectedHead)
    throw new Error("Checkout does not match the expected head commit.");
  if (git(["status", "--porcelain", "--untracked-files=no"]))
    throw new Error("Commit tracked source changes before verification.");
  const before = JSON.parse(await readFile(report, "utf8"));
  const outputDirectory = output ? resolve(output) : join(cwd, ".pr", "executions", randomUUID());
  // Never replace a previous execution or report.
  await mkdir(dirname(outputDirectory), { recursive: true });
  await mkdir(outputDirectory);
  const execution = { location, executor, head: expectedHead, application_revision: "unknown" };
  const started = Date.now();
  const result = await boundedProcess(
    process.execPath,
    [cli, "rerun", "--run", report, "--strict", "--json"],
    {
      cwd,
      env: { ...clean, PRQ_EXECUTION_LOCATION: location, PRQ_EXECUTOR: executor },
      timeout,
    },
  );
  let fresh = null;
  let reason = null;
  try {
    const parsed = JSON.parse(result.stdout);
    if (!Array.isArray(parsed.claims) || !parsed.report) throw new Error();
    const artifact = resolve(parsed.report);
    const inside = relative(join(cwd, ".pr", "runs"), artifact);
    if (inside.startsWith("..") || isAbsolute(inside)) throw new Error();
    fresh = JSON.parse(await readFile(artifact, "utf8"));
    if (
      fresh.id === before.id ||
      fresh.subject.head !== expectedHead ||
      fresh.source.hash !== before.source.hash ||
      fresh.execution?.location !== location ||
      fresh.execution?.executor !== executor ||
      JSON.stringify(fresh.claims.map(({ id, text }) => ({ id, text }))) !==
        JSON.stringify(before.claims.map(({ id, text }) => ({ id, text })))
    )
      throw new Error();
    fresh = { ...fresh, report: artifact };
  } catch {
    fresh = null;
    reason =
      "No matching fresh report was produced. Retain the run directory and inspect PRQ diagnostics; previous evidence is not a fresh pass.";
  }
  const outcome = {
    format: "prq-execution/v1",
    execution,
    duration_ms: Date.now() - started,
    exit_code: result.error || !fresh || ![0, 1, 2].includes(result.status) ? 2 : result.status,
    report: fresh?.report ?? null,
    evidence_directory: join(cwd, ".pr", "runs"),
    reason,
  };
  await writeFile(join(outputDirectory, "execution.json"), `${JSON.stringify(outcome, null, 2)}\n`);
  let diagnostics = result.stderr;
  for (const key of [env.OPENAI_API_KEY, env.OPENROUTER_API_KEY].filter(Boolean))
    diagnostics = diagnostics.replaceAll(key, "[redacted]");
  await writeFile(join(outputDirectory, "diagnostics.txt"), diagnostics);
  if (fresh)
    await writeFile(
      join(outputDirectory, "proof-request.json"),
      `${JSON.stringify(fresh, null, 2)}\n`,
    );
  return { ...outcome, output_directory: outputDirectory };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: {
        cli: { type: "string" },
        cwd: { type: "string", default: "." },
        report: { type: "string" },
        head: { type: "string" },
        location: { type: "string", default: "local" },
        executor: { type: "string", default: "cli" },
        output: { type: "string" },
        collect: { type: "boolean", default: false },
      },
    });
    const outcome = await portableRun({ ...values, expectedHead: values.head });
    process.stdout.write(`${JSON.stringify(outcome)}\n`);
    process.exitCode = values.collect ? 0 : outcome.exit_code;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Execution unavailable."}\n`);
    process.exitCode = 2;
  }
}
