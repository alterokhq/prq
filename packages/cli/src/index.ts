#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { ClaimExtractionIssue, fixPrompt, lockClaims, summarize } from "@prq/core";
import { renderPage } from "@prq/render";
import { Command, InvalidArgumentError } from "commander";
import { execa } from "execa";
import open from "open";
import { agentJson, clip } from "./agent-output.js";
import { initProject } from "./init.js";
import { readProof, saveProof } from "./storage.js";
import { type RunOptions, repoRoot, runProof, UsageIssue } from "./workflow.js";

if (existsSync(".env")) {
  try {
    process.loadEnvFile(".env");
  } catch {}
}
const program = new Command("prq")
  .description("Your agent said it works. Prove it.")
  .version("0.1.0");
function timeout(value: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 100 || number > 3_600_000)
    throw new InvalidArgumentError("Use milliseconds between 100 and 3600000.");
  return number;
}
function flags(command: Command): Command {
  return command
    .option("--json", "compact summary and broken rows")
    .option("--quiet", "hide live terminal output")
    .option("--no-open", "save the page without opening a browser")
    .option("--app-url <url>", "URL of the already running application")
    .option("--timeout <ms>", "time limit per check", timeout);
}
async function execute(options: RunOptions, rerun = false) {
  const root = await repoRoot();
  const previous = rerun ? await readProof(join(root, ".pr", "last.json")) : undefined;
  const { pr, reportPath } = await runProof(root, options, previous);
  const jsonPath = relative(root, join(root, ".pr", "runs", pr.id, "proof-request.json"));
  if (options.json) process.stdout.write(`${agentJson(pr, jsonPath)}\n`);
  if (options.open !== false && !options.json && !options.quiet)
    await open(reportPath).catch(() => process.stderr.write(`Open ${reportPath}\n`));
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
program
  .command("render <json>")
  .description("render saved JSON as HTML on stdout")
  .action(async (path: string) => {
    process.stdout.write(renderPage(await readProof(path)));
  });
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
  .command("open")
  .description("open the last saved Proof Request")
  .action(async () => {
    const root = await repoRoot();
    const pr = await readProof(join(root, ".pr", "last.json"));
    await open(join(root, ".pr", "runs", pr.id, "index.html"));
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
    issue instanceof UsageIssue || issue instanceof ClaimExtractionIssue
      ? issue.message
      : status
        ? `Claim extraction unavailable (HTTP ${status}). Check model access and configuration.`
        : "Verification unavailable. Check your source file, application, dependencies, and API key.";
  if (process.argv.includes("--json"))
    process.stdout.write(
      `${JSON.stringify({ status: "unverified", reason: clip(message, 220) })}\n`,
    );
  else process.stderr.write(`prq: ${message}\n`);
  process.exitCode = 2;
});
