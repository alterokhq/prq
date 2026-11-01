import { copyFile, mkdir, readFile, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { DraftClaim, Evidence, RunResult } from "@prq/core";
import { z } from "zod";

const ErrorDetail = z.object({ code: z.string(), message: z.string() });
const Artifact = z.object({ kind: z.string(), path: z.string().optional() });
const Step = z.object({
  api: z.string(),
  label: z.string(),
  status: z.string(),
  index: z.number(),
  screen: z
    .object({
      location: z.string(),
      nodes: z.number(),
      changes: z.array(z.string()),
      more: z.number().optional(),
    })
    .optional(),
  events: z
    .array(z.object({ kind: z.string(), status: z.string(), detail: z.string().optional() }))
    .optional(),
  explanation: z.string().optional(),
  error: ErrorDetail.optional(),
  cache: z.object({ mode: z.string(), replayedActions: z.number().optional() }).optional(),
});
const Attempt = z.object({
  status: z.string(),
  durationMs: z.number(),
  error: ErrorDetail.optional(),
  artifacts: z.array(Artifact),
  steps: z.array(Step),
  appLog: z
    .array(
      z.object({
        source: z.string(),
        level: z.string(),
        text: z.string(),
        step: z.number().optional(),
      }),
    )
    .optional(),
});
export const E2eReport = z.object({
  schemaVersion: z.literal("report-1"),
  run: z.object({
    results: z.array(
      z.object({
        testId: z.string(),
        titlePath: z.array(z.string()),
        file: z.string(),
        status: z.string(),
        attempts: z.array(Attempt),
      }),
    ),
    errors: z.array(ErrorDetail).optional(),
  }),
});

export function unverified(observed: string, duration_ms = 0): RunResult {
  return {
    observed,
    evidence: [{ type: "note", text: observed }],
    tester: "e2e / independent browser",
    duration_ms,
  };
}

async function containedFile(root: string, file: string): Promise<string> {
  const directory = await realpath(root);
  const target = await realpath(resolve(directory, file));
  const rel = relative(directory, target);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
    throw new Error("Artifact escaped report directory");
  return target;
}

export async function collectReport({
  report: input,
  claims,
  reportDir,
  runDir,
  testFile,
  testFiles,
}: {
  report: unknown;
  claims: DraftClaim[];
  reportDir: string;
  runDir: string;
  testFile?: string;
  testFiles?: ReadonlyMap<string, string>;
}): Promise<Map<string, RunResult>> {
  const report = E2eReport.parse(input);
  const output = new Map<string, RunResult>();
  for (const claim of claims) {
    const expectedFile = testFiles ? testFiles.get(claim.id) : testFile;
    const matches = report.run.results.filter(
      (result) =>
        expectedFile !== undefined &&
        result.file === expectedFile &&
        result.titlePath.at(-1) === `${claim.id}: ${claim.text}`,
    );
    if (!matches.length) {
      output.set(claim.id, unverified("No matching browser result was recorded for this claim."));
      continue;
    }
    const evidence: Evidence[] = [];
    const outcomes: Array<boolean | undefined> = [];
    const completedAssertions: boolean[] = [];
    const steps: Array<{ action: string; observation?: string }> = [];
    let duration_ms = 0;
    let cached = false;
    let observed = "The browser assertion did not complete.";
    for (const [targetIndex, result] of matches.entries()) {
      const attempt = result.attempts.at(-1);
      if (!attempt) {
        outcomes.push(undefined);
        completedAssertions.push(false);
        continue;
      }
      duration_ms += attempt.durationMs;
      const assertion = attempt.steps.findLast(
        (step) => step.api === "agent.assert" && step.label === claim.text,
      );
      const contradicted =
        assertion?.status === "failed" && assertion.error?.code === "ASSERTION_FAILED";
      const completed = result.status === "passed" && assertion?.status === "passed";
      const inconclusive =
        assertion?.status === "failed" && assertion.error?.code === "ASSERTION_INCONCLUSIVE";
      completedAssertions.push(contradicted || completed || inconclusive);
      outcomes.push(contradicted ? false : completed ? true : undefined);
      observed =
        assertion?.explanation ??
        attempt.error?.message ??
        (completed
          ? "The live browser assertion held."
          : "The browser assertion did not complete.");
      cached ||= attempt.steps.some(
        (step) => step.api === "agent.act" && (step.cache?.replayedActions ?? 0) > 0,
      );
      for (const step of attempt.steps) {
        const actions = (step.events ?? [])
          .filter(
            (event) =>
              ["engine", "navigation"].includes(event.kind) &&
              event.status === "passed" &&
              event.detail,
          )
          .map((event) => event.detail)
          .join("; ");
        steps.push({
          action: (actions || step.api).slice(0, 1000),
          ...(step.screen
            ? {
                observation:
                  `${step.screen.location} (${step.screen.nodes} nodes): ${step.screen.changes.join("; ")}${step.screen.more ? `; ${step.screen.more} further changes omitted by e2e` : ""}`.slice(
                    0,
                    2400,
                  ),
              }
            : {}),
        });
        evidence.push({
          type:
            step.api === "agent.assert" &&
            (step.status === "passed" || step.error?.code === "ASSERTION_FAILED")
              ? "assertion"
              : "note",
          text: `${step.api}: ${step.label}${step.explanation ? ` — ${step.explanation}` : ""}${step.error ? ` [${step.error.code}]` : ""}`,
          ...(step.api === "agent.assert" &&
          (step.status === "passed" || step.error?.code === "ASSERTION_FAILED")
            ? { passed: step.status === "passed" }
            : {}),
          step: step.index,
        });
      }
      for (const line of attempt.appLog ?? []) {
        evidence.push({
          type: line.source === "console" || line.source === "error" ? "console" : "note",
          level: line.level,
          text: line.text,
          ...(line.step === undefined ? {} : { step: line.step }),
        });
      }
      const safeId = claim.id.replace(/[^a-zA-Z0-9_-]/g, "_");
      const destination = join(runDir, "evidence", `${safeId}-${targetIndex}`);
      await mkdir(destination, { recursive: true });
      let firstArtifact: string | undefined;
      for (const [index, artifact] of attempt.artifacts.entries()) {
        if (!artifact.path || !["screenshot", "log"].includes(artifact.kind)) continue;
        try {
          const source = await containedFile(join(reportDir, "results"), artifact.path);
          firstArtifact ??= artifact.path;
          const target = join(destination, `${index}-${basename(source)}`);
          await copyFile(source, target);
          evidence.push({
            type: artifact.kind === "screenshot" ? "screenshot" : "note",
            path: relative(runDir, target).split(sep).join("/"),
            ...(artifact.kind === "log"
              ? { text: (await readFile(source, "utf8")).slice(0, 12000) }
              : {}),
          });
        } catch {
          evidence.push({ type: "note", text: `Artifact unavailable: ${basename(artifact.path)}` });
        }
      }
      if (firstArtifact) {
        const testDirectory = firstArtifact.split("/")[0];
        if (testDirectory) {
          try {
            const source = await containedFile(
              join(reportDir, "results"),
              join(testDirectory, "trace.md"),
            );
            const target = join(destination, "trace.md");
            await copyFile(source, target);
            evidence.push({
              type: "note",
              path: relative(runDir, target).split(sep).join("/"),
              text: (await readFile(source, "utf8")).slice(0, 16000),
            });
          } catch {
            /* Individual step evidence remains available without a trace. */
          }
        }
      }
    }
    const passed = outcomes.some((value) => value === false)
      ? false
      : outcomes.every((value) => value === true)
        ? true
        : undefined;
    output.set(claim.id, {
      ...(passed === undefined
        ? completedAssertions.every(Boolean)
          ? { completed: true }
          : {}
        : { passed }),
      steps: steps.slice(-30),
      observed,
      evidence,
      tester: "e2e / independent browser",
      cached,
      duration_ms,
    });
  }
  return output;
}
