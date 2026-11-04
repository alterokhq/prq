import type { Reporter, Suite, TestResult, TestStep } from "@playwright/test/reporter";
import type { TestCaseResult } from "@prq/core";
import { writeTestReport } from "./reporter-output.js";

function assertionFailed(steps: TestStep[]): boolean {
  return steps.some(
    (step) =>
      step.category !== "hook" &&
      ((step.category === "expect" && Boolean(step.error)) || assertionFailed(step.steps)),
  );
}

export default class PrqPlaywrightReporter implements Reporter {
  private suite?: Suite;
  private errors = 0;
  onBegin: NonNullable<Reporter["onBegin"]> = (_config, suite) => {
    this.suite = suite;
    this.errors = 0;
  };
  onError() {
    this.errors++;
  }
  onEnd: NonNullable<Reporter["onEnd"]> = async (run) => {
    const tests = (this.suite?.allTests() ?? []).map((test): TestCaseResult => {
      const last: TestResult | undefined = test.results.at(-1);
      let status: TestCaseResult["status"] = "unknown";
      if (test.outcome() === "flaky") status = "flaky";
      else if (test.expectedStatus === "failed" && test.outcome() === "expected")
        status = "expected_failed";
      else if (test.expectedStatus === "failed" && last?.status === "passed") status = "unknown";
      else if (last?.status === "passed") status = test.results.length > 1 ? "flaky" : "passed";
      else if (last?.status === "skipped") status = "skipped";
      else if (last?.status === "timedOut" || last?.status === "interrupted")
        status = "interrupted";
      else if (last?.status === "failed") status = assertionFailed(last.steps) ? "failed" : "error";
      return {
        name: test.titlePath().join(" > ").slice(0, 2000),
        status,
        attempts: test.results.length,
        attachments: test.results.flatMap((r) =>
          r.attachments.flatMap((a) => (a.path ? [{ name: a.name, path: a.path }] : [])),
        ),
      };
    });
    await writeTestReport(
      "playwright",
      Boolean(this.suite) && (run.status === "passed" || run.status === "failed"),
      this.errors,
      tests,
    );
  };
}
