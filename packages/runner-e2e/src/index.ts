import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { DraftClaim, RunContext, Runner, RunResult } from "@prq/core";
import { execa } from "execa";
import { withModelConfig } from "./model-config.js";
import { collectReport, unverified } from "./report.js";
import { planTestFiles, withTestFiles } from "./test-files.js";

export { collectReport, E2eReport } from "./report.js";
export { generateTestFile } from "./test-files.js";

export const e2eRunner: Runner = {
  kind: "browser",
  async run(claims: DraftClaim[], ctx: RunContext): Promise<Map<string, RunResult>> {
    if (!claims.length) return new Map();
    const started = Date.now();
    const pending = (message: string) =>
      new Map(claims.map((claim) => [claim.id, unverified(message, Date.now() - started)]));
    const probeTimeout = Math.min(ctx.timeoutMs, 15000);
    let app: Response;
    try {
      app = await fetch(ctx.appUrl, { signal: AbortSignal.timeout(probeTimeout) });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      return pending(
        timedOut
          ? `The target application did not respond within ${probeTimeout}ms at ${ctx.appUrl}; browser assertions did not run.`
          : `The target application is unreachable at ${ctx.appUrl}. Start it or check --app-url; browser assertions did not run.`,
      );
    }
    try {
      if (!app.ok)
        return pending(
          `The target application returned HTTP ${app.status}; browser assertions did not run.`,
        );
      const require = createRequire(join(ctx.worktree, "package.json"));
      const e2eEntry = require.resolve("e2e");
      const binary = join(dirname(e2eEntry), "cli", "bin.js");
      if (!existsSync(binary))
        return pending("Install e2e in the target project before checking browser claims.");
      const files = planTestFiles(claims, ctx.worktree, ctx.testFile);
      return await withTestFiles(files, async () => {
        const reportDir = join(ctx.worktree, ".pr", "e2e", randomUUID());
        await mkdir(reportDir, { recursive: true });
        for (const claim of claims) ctx.onProgress?.(claim.id, "checking the running application");
        const subprocessStarted = Date.now();
        const run = await withModelConfig(ctx, (configArgs) => {
          ctx.onBrowserStart?.();
          return execa(
            process.execPath,
            [
              binary,
              "run",
              ...configArgs,
              ...files.map((file) => file.relativePath),
              "--output",
              reportDir,
              "--reporter",
              "list,markdown",
              "--trace",
              "on",
              "--retries",
              "0",
              "--workers",
              "4",
              "--max-duration",
              String(ctx.timeoutMs),
              ...(ctx.cacheDir ? ["--cache-dir", ctx.cacheDir] : []),
            ],
            {
              cwd: ctx.worktree,
              env: { PRQ_APP_URL: ctx.appUrl, E2E_TELEMETRY_DISABLED: "1", NO_COLOR: "1" },
              reject: false,
              timeout: ctx.timeoutMs + 30000,
              forceKillAfterDelay: 2000,
              maxBuffer: 2 * 1024 * 1024,
            },
          );
        });
        const subprocessMs = Date.now() - subprocessStarted;
        if (run.timedOut)
          return pending("The browser runner timed out before completing its report.");
        const collectStarted = Date.now();
        const report: unknown = JSON.parse(await readFile(join(reportDir, "report.json"), "utf8"));
        const results = await collectReport({
          report,
          claims,
          reportDir,
          runDir: ctx.runDir,
          testFiles: new Map(files.map((file) => [file.claimId, file.relativePath])),
        });
        const collectMs = Date.now() - collectStarted;
        for (const result of results.values()) {
          if (ctx.browserModel)
            result.tester = `e2e / ${ctx.browserModel.provider} ${ctx.browserModel.model}`;
          result.evidence.unshift({
            type: "note",
            text: `Runner timing: browser subprocess ${subprocessMs}ms; evidence collection ${collectMs}ms. Availability only: GET ${ctx.appUrl} returned HTTP ${app.status} before browser checks. This does not verify the claim.`,
          });
        }
        return results;
      });
    } catch {
      return pending(
        "The browser runner could not start e2e or collect a valid report. Check the installed e2e tooling and project configuration.",
      );
    }
  },
};
