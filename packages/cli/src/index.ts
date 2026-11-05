#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  ClaimExtractionIssue,
  fixPrompt,
  lockClaims,
  ProviderConfigurationIssue,
  summarize,
  verificationExitCode,
} from "@prq/core";
import { Command, InvalidArgumentError, Option } from "commander";
import { execa } from "execa";
import { agentJson, clip, fullJson } from "./agent-output.js";
import { EvaluationIssue, evaluate } from "./evaluate.js";
import { checkHandoff } from "./gate.js";
import { HandoffIssue } from "./handoff.js";
import { initProject } from "./init.js";
import { ProjectIssue, selectProject } from "./project.js";
import { readProof, saveProof } from "./storage.js";
import { createTerminalView } from "./terminal.js";
import { type RunOptions, repoRoot, runProof, UsageIssue } from "./workflow.js";

if (existsSync(".env")) {
  try {
    process.loadEnvFile(".env");
  } catch {}
}
const program = new Command("prq")
  .description("Your agent said it works. Prove it.")
  .version("0.2.0");
function timeout(value: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 100 || number > 3_600_000)
    throw new InvalidArgumentError("Use milliseconds between 100 and 3600000.");
  return number;
}
function flags(command: Command): Command {
  return command
    .option("--project <directory>", "project directory, relative to the repository root")
    .option("--strict", "exit nonzero for unresolved claims or unfinished work")
    .option("--json", "complete machine-readable report")
    .option("--summary", "compact agent summary with the full report path")
    .option("--quiet", "hide live terminal output")
    .addOption(
      new Option("--no-open", "accepted for compatibility; prq never opens a browser").hideHelp(),
    )
    .option("--provider <provider>", "openai or openrouter (or PRQ_PROVIDER)")
    .option("--model <model>", "extraction, classification and browser model (or PRQ_MODEL)")
    .option("--judge-model <model>", "independent judge model (or PRQ_JUDGE_MODEL)")
    .option("--decision-mode <mode>", "decisions or structured (or PRQ_DECISION_MODE)")
    .option("--app-url <url>", "URL of the already running application")
    .option("--timeout <ms>", "time limit per check", timeout);
}
async function execute(options: RunOptions, rerun = false) {
  if (options.json && options.summary)
    throw new UsageIssue("Choose --json or --summary, not both.");
  if ([options.claims, options.claimsJson, options.fromStdin].filter(Boolean).length > 1)
    throw new UsageIssue("Choose one input: --claims, --claims-json, or --from-stdin.");
  if (rerun && (options.claims || options.claimsJson || options.fromStdin))
    throw new UsageIssue(
      "Rerun uses the selected report's locked claims; do not supply replacement claims.",
    );
  if (!rerun && options.strict && !options.claimsJson)
    throw new UsageIssue("Strict verification requires an explicit --claims-json handoff.");
  const root = await repoRoot();
  const previous = rerun
    ? await readProof(options.run ? resolve(options.run) : join(root, ".pr", "last.json"))
    : undefined;
  const { pr } = await runProof(root, options, previous);
  const jsonPath = join(root, ".pr", "runs", pr.id, "proof-request.json");
  if (options.json) process.stdout.write(`${fullJson(pr, jsonPath)}\n`);
  else if (options.summary) process.stdout.write(`${agentJson(pr, jsonPath)}\n`);
  process.exitCode = verificationExitCode(pr, options.strict);
}
flags(program)
  .option("--claims-json <file>", "explicit builder handoff in prq-claims/v1 format")
  .option("--claims <file>", "file containing the agent's done message")
  .option("--from-stdin", "read the agent's done message from stdin")
  .action((_options: RunOptions, command: Command) =>
    execute(command.optsWithGlobals<RunOptions>()),
  );
flags(program.command("rerun").description("verify the same locked claims with fresh evidence"))
  .option("--run <json>", "specific saved report to rerun")
  .action((_options: RunOptions, command: Command) =>
    execute(command.optsWithGlobals<RunOptions>(), true),
  );
for (const name of ["open", "render"]) {
  program.command(`${name} [json]`, { hidden: true }).action(() => {
    throw new UsageIssue(
      `prq ${name} was removed in 0.2. Use prq show [json], or prq show --json.`,
    );
  });
}
program
  .command("fix")
  .description("print a short prompt for broken or human-rejected claims")
  .option("--run <json>", "saved Proof Request JSON")
  .option("--copy", "copy the prompt to the clipboard")
  .action(async (options: { run?: string; copy?: boolean }) => {
    const root = await repoRoot();
    const path = options.run ? resolve(options.run) : join(root, ".pr", "last.json");
    const pr = await readProof(path);
    const prompt = fixPrompt(pr);
    if (options.copy) {
      const clipboard =
        process.platform === "darwin"
          ? (["pbcopy", []] as const)
          : process.platform === "win32"
            ? (["clip", []] as const)
            : (["xclip", ["-selection", "clipboard"]] as const);
      const copied = await execa(clipboard[0], [...clipboard[1]], {
        input: prompt,
        reject: false,
      }).catch(() => undefined);
      if (copied?.exitCode !== 0)
        throw new UsageIssue("Clipboard unavailable. Copy the output of prq fix.");
    }
    process.stdout.write(`${prompt || "no broken or human-rejected claims to repair."}\n`);
  });
program
  .command("signoff <id>")
  .description("record a named decision on a human claim")
  .option("--run <json>", "specific saved report to sign off")
  .requiredOption("--by <name>")
  .option("--accept")
  .option("--reject")
  .option("--reason <text>")
  .action(
    async (
      id: string,
      options: { by: string; accept?: boolean; reject?: boolean; reason?: string; run?: string },
    ) => {
      if (Boolean(options.accept) === Boolean(options.reject))
        throw new UsageIssue("Choose exactly one of --accept or --reject.");
      if (!options.by.trim()) throw new UsageIssue("Provide the person's name with --by.");
      const root = await repoRoot();
      const pr = await readProof(
        options.run ? resolve(options.run) : join(root, ".pr", "last.json"),
      );
      if (lockClaims(pr.claims) !== pr.source.hash)
        throw new UsageIssue("The saved claims do not match their lock.");
      const claim = pr.claims.find((row) => row.id === id);
      if (claim?.verdict !== "needs_human")
        throw new UsageIssue("Choose a claim that needs a human.");
      if (claim.signoff)
        throw new UsageIssue(
          "This claim already has a named decision. Rerun before recording a new decision.",
        );
      claim.assignee = options.by.trim();
      claim.signoff = {
        by: options.by.trim(),
        decision: options.accept ? "accepted" : "rejected",
        reason: options.reason,
        at: new Date().toISOString(),
      };
      pr.summary = summarize(pr.claims);
      const path = await saveProof(root, pr);
      process.stdout.write(
        `${id} ${claim.signoff.decision} by ${clip(claim.signoff.by, 60)}\n${path}\n`,
      );
    },
  );
program
  .command("show [json]")
  .description("inspect a saved report in the terminal")
  .option("--json", "complete machine-readable report")
  .option("--summary", "compact agent summary")
  .action(async (path: string | undefined, _options: unknown, command: Command) => {
    const options = command.optsWithGlobals<RunOptions>();
    if (options.json && options.summary)
      throw new UsageIssue("Choose --json or --summary, not both.");
    const report = path ? resolve(path) : join(await repoRoot(), ".pr", "last.json");
    const pr = await readProof(report);
    // Evidence paths are relative to the run directory, never the latest-report alias.
    const artifact = path
      ? report
      : join(await repoRoot(), ".pr", "runs", pr.id, "proof-request.json");
    if (options.json || options.summary) {
      process.stdout.write(
        `${options.summary ? agentJson(pr, artifact) : fullJson(pr, artifact)}\n`,
      );
      return;
    }
    const view = createTerminalView({});
    try {
      view.start({ subject: pr.subject, claims: pr.claims, hash: pr.source.hash });
      for (const claim of pr.claims) view.resolve(claim);
      view.finish(pr, { reportPath: artifact });
    } finally {
      view.stop();
    }
  });
program
  .command("init")
  .description("prepare local config and agent instructions")
  .option("--project <directory>", "project directory, relative to the repository root")
  .action(async (_options: unknown, command: Command) => {
    const root = await repoRoot();
    const options = command.optsWithGlobals<RunOptions>();
    const project = await selectProject(root, options.project);
    const notes = await initProject(root, existsSync(join(root, ".codex")), project.directory);
    process.stdout.write(`${notes.join("\n")}\n`);
  });
program
  .command("gate <json>")
  .description("check this handoff's report before PR creation, without a model call")
  .option("--claims-json <file>", "the builder's original claims handoff")
  .option("--json", "machine-readable gate result")
  .action(async (path: string, _options: unknown, command: Command) => {
    const options = command.optsWithGlobals<{
      claimsJson: string;
      json?: boolean;
      summary?: boolean;
    }>();
    if (!options.claimsJson)
      throw new UsageIssue("Supply the original handoff with --claims-json <file>.");
    const result = await checkHandoff(
      await repoRoot(),
      await readProof(resolve(path)),
      resolve(options.claimsJson),
    );
    const { exitCode, ...output } = result;
    process.stdout.write(
      options.json || options.summary
        ? `${JSON.stringify(output)}\n`
        : `${result.ready ? "Ready for PR handoff." : result.issues.join("\n")}\n`,
    );
    process.exitCode = exitCode;
  });
program
  .command("eval")
  .description("evaluate fixed cases offline, or explicitly call a provider with --live")
  .option("--live", "paid provider judgment of synthetic evidence and task coverage")
  .option("--case <ids>", "comma-separated case IDs, or all", "all")
  .option("--out <file>", "write a new JSON artifact without overwriting a previous run")
  .option("--json", "complete machine-readable evaluation report")
  .option("--provider <provider>", "openai or openrouter")
  .option("--model <model>", "task coverage model")
  .option("--judge-model <model>", "claim judge model")
  .option("--decision-mode <mode>", "decisions or structured")
  .option("--timeout <ms>", "timeout per model request", timeout)
  .action(async (_options: unknown, command: Command) => {
    const options = command.optsWithGlobals<Parameters<typeof evaluate>[0] & { json?: boolean }>();
    const report = await evaluate(options);
    if (options.json) process.stdout.write(`${JSON.stringify(report)}\n`);
    else {
      process.stdout.write(`PRQ evaluations (${report.mode})\n${report.scope}\n`);
      for (const row of report.cases)
        process.stdout.write(
          `${row.matched ? "PASS" : "FAIL"} ${row.id}: expected ${row.expected}, actual ${row.actual} [${row.execution}]\n`,
        );
      process.stdout.write(
        `${report.summary.matched}/${report.summary.total} matched; ${report.summary.false_passes} false passes; ${report.summary.false_alarms} false alarms; ${report.summary.duration_ms} ms\n`,
      );
      process.stdout.write(
        report.summary.cost_complete
          ? `cost $${report.summary.cost_usd}\n`
          : `reported cost ${report.summary.reported_cost_usd ?? "unavailable"}; total unavailable\n`,
      );
      if (options.out) process.stdout.write(`Report: ${resolve(options.out)}\n`);
    }
    process.exitCode = report.summary.mismatched ? 1 : 0;
  });
program.parseAsync().catch((issue: unknown) => {
  const status =
    issue instanceof Error && "statusCode" in issue && typeof issue.statusCode === "number"
      ? issue.statusCode
      : undefined;
  const message =
    issue instanceof UsageIssue ||
    issue instanceof EvaluationIssue ||
    issue instanceof ProjectIssue ||
    issue instanceof HandoffIssue ||
    issue instanceof ClaimExtractionIssue ||
    issue instanceof ProviderConfigurationIssue
      ? issue.message
      : status
        ? `Claim extraction unavailable (HTTP ${status}). Check model access and configuration.`
        : "Verification unavailable. Check your source file, application, dependencies, and API key.";
  if (process.argv.includes("--json") || process.argv.includes("--summary"))
    process.stdout.write(
      `${JSON.stringify({ format: "prq-error/v1", status: "unverified", reason: message })}\n`,
    );
  else process.stderr.write(`prq: ${message}\n`);
  process.exitCode = 2;
});
