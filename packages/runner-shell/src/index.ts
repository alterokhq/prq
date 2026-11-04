import { existsSync } from "node:fs";
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import type { DraftClaim, RunContext, Runner, RunResult } from "@prq/core";
import { execa } from "execa";
import { copyDependencies } from "./dependencies.js";
import { collectTestReport, prepareTestReport } from "./test-report.js";

const tester = "shell / isolated HEAD worktree";

function commandEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "HOME", "TMPDIR", "TEMP", "SystemRoot", "COMSPEC", "SHELL"]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  env.CI = "1";
  env.NO_COLOR = "1";
  return env;
}

function unavailable(message: string, started: number): RunResult {
  return {
    observed: message,
    evidence: [{ type: "note", text: message }],
    tester,
    duration_ms: Date.now() - started,
  };
}

async function runClaim(claim: DraftClaim, ctx: RunContext): Promise<RunResult> {
  const started = Date.now();
  const command = claim.check?.command;
  if (!command?.trim()) return unavailable("No command was supplied for this claim.", started);
  let temporary: string | undefined;
  let checkout: string | undefined;
  let created = false;
  let result: RunResult = unavailable("The command did not execute.", started);
  try {
    const root = await realpath(ctx.worktree);
    const project = relative(root, await realpath(ctx.projectDir ?? root));
    if (project === ".." || project.startsWith(`..${sep}`) || isAbsolute(project))
      return unavailable("The project directory is outside the repository.", started);
    const head = await execa("git", ["rev-parse", ctx.head ?? "HEAD"], { cwd: root });
    temporary = await mkdtemp(join(tmpdir(), "prq-command-"));
    checkout = join(temporary, "checkout");
    await execa("git", ["worktree", "add", "--detach", checkout, head.stdout.trim()], {
      cwd: ctx.worktree,
      timeout: ctx.timeoutMs,
    });
    created = true;
    const workingDirectory = join(checkout, project);
    if (!(await stat(workingDirectory)).isDirectory())
      throw new Error("Project absent from committed source");
    await copyDependencies(root, checkout, project);
    const reportPath = ctx.testReports?.get(command);
    let report: Awaited<ReturnType<typeof prepareTestReport>> | undefined;
    if (reportPath) {
      try {
        report = await prepareTestReport(workingDirectory, reportPath);
      } catch {
        return unavailable(
          "Could not prepare a fresh JSON report path. Use an untracked file inside the project, outside Git metadata and dependencies.",
          started,
        );
      }
    }
    ctx.onProgress?.(claim.id, `running ${command}`);
    const execution = await execa(command, {
      cwd: workingDirectory,
      shell: true,
      reject: false,
      timeout: ctx.timeoutMs,
      forceKillAfterDelay: 1000,
      maxBuffer: 1024 * 1024,
      env: {
        ...commandEnvironment(),
        ...(report ? { PRQ_TEST_REPORT: report.target, PRQ_RUN_TOKEN: report.token } : {}),
      },
      extendEnv: false,
    });
    const stdout = execution.stdout.slice(-8000);
    const stderr = execution.stderr.slice(-8000);
    const missingTool = execution.exitCode === 127 || execution.exitCode === 126;
    const missingDependency =
      /(?:ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find (?:module|package)|command not found|node_modules missing)/i.test(
        `${stdout}\n${stderr}`,
      );
    if (
      execution.timedOut ||
      execution.isTerminated ||
      execution.exitCode === undefined ||
      missingTool ||
      missingDependency
    ) {
      result = unavailable(
        execution.timedOut
          ? "The command timed out before producing a complete result."
          : "The command could not complete because its execution environment was unavailable.",
        started,
      );
    } else {
      result = {
        passed: execution.exitCode === 0,
        observed: `${command} exited ${execution.exitCode}`,
        evidence: [],
        tester,
        duration_ms: Date.now() - started,
      };
    }
    result.evidence.push({
      type: "command",
      command,
      ...(execution.exitCode === undefined ? {} : { exit_code: execution.exitCode }),
      stdout,
      stderr,
    });
    if (report) {
      try {
        const collected = await collectTestReport({
          project: workingDirectory,
          target: report.target,
          token: report.token,
          runDir: ctx.runDir,
          claimId: claim.id,
        });
        const commandEvidence = result.evidence.find((e) => e.type === "command");
        if (commandEvidence) {
          commandEvidence.test_summary = collected.summary;
          commandEvidence.path = collected.path;
        }
        for (const note of collected.notes) result.evidence.push({ type: "note", text: note });
      } catch {
        result.passed = undefined;
        result.observed =
          "The configured test report is missing, malformed, oversized or not from this execution. Check the PRQ reporter setup.";
        result.evidence.push({ type: "note", text: result.observed });
      }
    }
    result.evidence.push({
      type: "note",
      text: `Executed committed HEAD ${head.stdout.trim()}, project ${project || "."}, in a fresh detached worktree. Installed dependencies were copied into this checkout; this is not an operating-system sandbox.`,
    });
  } catch {
    result = unavailable(
      "The isolated command runner could not prepare the committed project or its workspace dependencies. Check the project path, installed dependencies and links; dependencies outside the repository are unsupported.",
      started,
    );
  } finally {
    if (created && checkout) {
      try {
        await execa("git", ["worktree", "remove", "--force", checkout], { cwd: ctx.worktree });
      } catch {
        result.evidence.push({
          type: "note",
          text: `The disposable worktree needs cleanup: ${checkout}`,
        });
      }
    }
    if (temporary && (!checkout || !existsSync(checkout)))
      await rm(temporary, { recursive: true, force: true });
  }
  return result;
}

export const shellRunner: Runner = {
  kind: "command",
  async run(claims, ctx) {
    return new Map(
      await Promise.all(
        claims.map(
          async (claim): Promise<[string, RunResult]> => [claim.id, await runClaim(claim, ctx)],
        ),
      ),
    );
  },
};
