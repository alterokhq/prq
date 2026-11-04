import { z } from "zod";

export const TestStatus = z.enum([
  "passed",
  "failed",
  "skipped",
  "todo",
  "flaky",
  "interrupted",
  "error",
  "unknown",
  "expected_failed",
]);
export const TestCaseResult = z.object({
  name: z.string().max(2000),
  status: TestStatus,
  attempts: z.number().int().nonnegative().max(10000),
  attachments: z
    .array(z.object({ name: z.string(), path: z.string() }))
    .max(100)
    .default([]),
});
export type TestCaseResult = z.infer<typeof TestCaseResult>;

const frameworkName = z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,99}$/);

/** Framework reporters emit this contract; a run token binds it to this execution. */
export const TestReport = z
  .object({
    format: z.literal("prq-test-results/v1"),
    framework: frameworkName,
    run_token: z.string().min(1).max(100),
    complete: z.boolean(),
    errors: z.number().int().nonnegative(),
    tests: z.array(TestCaseResult).max(100000),
  })
  .strict()
  .superRefine((report, ctx) => {
    for (const [index, test] of report.tests.entries()) {
      if (
        ["passed", "failed", "flaky", "expected_failed"].includes(test.status) &&
        test.attempts === 0
      )
        ctx.addIssue({
          code: "custom",
          path: ["tests", index, "attempts"],
          message: "Completed tests require an attempt",
        });
      if (test.status === "passed" && test.attempts > 1)
        ctx.addIssue({
          code: "custom",
          path: ["tests", index, "status"],
          message: "Retried tests must retain their retry outcome",
        });
    }
  });
export type TestReport = z.infer<typeof TestReport>;

const count = z.number().int().nonnegative();
export const TestSummary = z.object({
  format: z.literal("prq-test-results/v1"),
  framework: frameworkName,
  complete: z.boolean(),
  errors: count,
  total: count,
  executed: count,
  passed: count,
  failed: count,
  skipped: count,
  todo: count,
  flaky: count,
  interrupted: count,
  error: count,
  unknown: count,
  expected_failed: count,
});
export type TestSummary = z.infer<typeof TestSummary>;

export function summarizeTests(report: TestReport): TestSummary {
  const counts = {
    passed: 0,
    failed: 0,
    skipped: 0,
    todo: 0,
    flaky: 0,
    interrupted: 0,
    error: 0,
    unknown: 0,
    expected_failed: 0,
  };
  for (const test of report.tests) counts[test.status]++;
  return {
    format: report.format,
    framework: report.framework,
    complete: report.complete,
    errors: report.errors,
    total: report.tests.length,
    executed: counts.passed + counts.failed + counts.flaky + counts.expected_failed,
    ...counts,
  };
}

/** A model cannot override absent or incomplete test execution. */
export function testEvidenceIssue(summary: TestSummary): string | undefined {
  if (
    !summary.complete ||
    summary.errors ||
    summary.error ||
    summary.interrupted ||
    summary.unknown
  )
    return "Test execution was incomplete or had setup/runtime errors. Inspect the report and rerun.";
  if (summary.executed === 0)
    return "No completed tests ran. Zero tests cannot verify a test-suite claim.";
  if (summary.skipped || summary.todo || summary.flaky || summary.expected_failed)
    return "Skipped, todo, flaky or expected-failure tests require resolution; they are not a fully passing suite.";
  return undefined;
}
