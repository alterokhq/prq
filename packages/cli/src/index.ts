#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  ClaimExtractionIssue,
  fixPrompt,
  lockClaims,
  ProviderConfigurationIssue,
  summarize,
} from "@prq/core";
import { Command, InvalidArgumentError, Option } from "commander";
import { execa } from "execa";
import { agentJson, clip, fullJson } from "./agent-output.js";
import { initProject } from "./init.js";
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
  const root = await repoRoot();
  const previous = rerun ? await readProof(join(root, ".pr", "last.json")) : undefined;
  const { pr } = await runProof(root, options, previous);
  const jsonPath = relative(root, join(root, ".pr", "runs", pr.id, "proof-request.json"));
  if (options.json) process.stdout.write(`${fullJson(pr, jsonPath)}\n`);
  else if (options.summary) process.stdout.write(`${agentJson(pr, jsonPath)}\n`);
  process.exitCode = pr.summary.broken > 0 ? 1 : pr.summary.unverified > 0 ? 2 : 0;
}
flags(program)
  .option("--claims <file>", "file containing the agent's done message")
  .option("--from-stdin", "read the agent's done message from stdin")
  .action((_options: RunOptions, command: Command) =>
    execute(command.optsWithGlobals<RunOptions>()),
  );
flags(
  program.command("rerun").description("verify the same locked claims with fresh evidence"),
).action((_options: RunOptions, command: Command) =>
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
  .description("print a short prompt for the broken claims")
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
    process.stdout.write(`${prompt || "nothing broken. nothing to fix."}\n`);
  });
program
  .command("signoff <id>")
  .description("record a named decision on a human claim")
  .requiredOption("--by <name>")
  .option("--accept")
  .option("--reject")
  .option("--reason <text>")
  .action(
    async (
      id: string,
      options: { by: string; accept?: boolean; reject?: boolean; reason?: string },
    ) => {
      if (Boolean(options.accept) === Boolean(options.reject))
        throw new UsageIssue("Choose exactly one of --accept or --reject.");
      if (!options.by.trim()) throw new UsageIssue("Provide the person's name with --by.");
      const root = await repoRoot();
      const pr = await readProof(join(root, ".pr", "last.json"));
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
  .action(async () => {
    const root = await repoRoot();
    const notes = await initProject(root, existsSync(join(root, ".codex")));
    process.stdout.write(`${notes.join("\n")}\n`);
  });
program.parseAsync().catch((issue: unknown) => {
  const status =
    issue instanceof Error && "statusCode" in issue && typeof issue.statusCode === "number"
      ? issue.statusCode
      : undefined;
  const message =
    issue instanceof UsageIssue ||
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
