import { constants, existsSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DraftClaim, RunContext, Runner, RunResult } from "@prq/core";
import { execa } from "execa";

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
    const head = await execa("git", ["rev-parse", "HEAD"], { cwd: ctx.worktree });
    temporary = await mkdtemp(join(tmpdir(), "prq-command-"));
    checkout = join(temporary, "checkout");
    await execa("git", ["worktree", "add", "--detach", checkout, head.stdout.trim()], {
      cwd: ctx.worktree,
      timeout: ctx.timeoutMs,
    });
    created = true;
    const dependencies = join(ctx.worktree, "node_modules");
    if (existsSync(dependencies)) {
      await cp(dependencies, join(checkout, "node_modules"), {
        recursive: true,
        verbatimSymlinks: true,
        mode: constants.COPYFILE_FICLONE,
      });
    }
    ctx.onProgress?.(claim.id, `running ${command}`);
    const execution = await execa(command, {
      cwd: checkout,
      shell: true,
      reject: false,
      timeout: ctx.timeoutMs,
      forceKillAfterDelay: 1000,
      maxBuffer: 1024 * 1024,
      env: commandEnvironment(),
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
    result.evidence.push({
      type: "note",
      text: `Executed committed HEAD ${head.stdout.trim()} in a fresh detached worktree. Installed dependencies were copied into this checkout; this is not an operating-system sandbox.`,
    });
  } catch {
    result = unavailable(
      "The isolated command runner could not start or collect its result.",
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
