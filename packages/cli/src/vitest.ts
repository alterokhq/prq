import type { TestCaseResult } from "@prq/core";
import type { Reporter } from "vitest/node";
import { writeTestReport } from "./reporter-output.js";

/** Uses Vitest lifecycle data and task hook states; compatibility is exercised with the real runner. */
export default class PrqVitestReporter implements Reporter {
  onTestRunEnd: NonNullable<Reporter["onTestRunEnd"]> = async (modules, errors, reason) => {
    const tests: TestCaseResult[] = [];
    let suiteErrors = errors.length;
    for (const module of modules) {
      suiteErrors += module.errors().length;
      for (const test of module.children.allTests()) {
        const result = test.result();
        const diagnostic = test.diagnostic();
        let status: TestCaseResult["status"];
        switch (result.state) {
          case "passed":
            status = test.options.fails
              ? "expected_failed"
              : diagnostic?.flaky || (diagnostic?.retryCount ?? 0) > 0
                ? "flaky"
                : diagnostic
                  ? "passed"
                  : "unknown";
            break;
          case "failed":
            status =
              !Object.values(
                test.project.vitest.state.idMap.get(test.id)?.result?.hooks ?? {},
              ).some((state) => state !== "pass") &&
              result.errors.length > 0 &&
              result.errors.every((e) => e.name === "AssertionError")
                ? "failed"
                : "error";
            break;
          case "skipped":
            status = test.options.mode === "todo" ? "todo" : "skipped";
            break;
          case "pending":
            status = "interrupted";
            break;
        }
        tests.push({
          name: test.fullName.slice(0, 2000),
          status,
          attempts: diagnostic ? diagnostic.retryCount + 1 : 0,
          attachments: [],
        });
      }
    }
    await writeTestReport("vitest", reason !== "interrupted", suiteErrors, tests);
  };
}
