import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { TestCaseResult, TestReport } from "@prq/core";

export async function writeTestReport(
  framework: string,
  complete: boolean,
  errors: number,
  tests: TestCaseResult[],
) {
  const target = process.env.PRQ_TEST_REPORT;
  if (!target)
    throw new Error(
      "Set PRQ_TEST_REPORT to the JSON output file, or run this reporter through prq.",
    );
  const report: TestReport = {
    format: "prq-test-results/v1",
    framework,
    run_token: process.env.PRQ_RUN_TOKEN ?? "standalone",
    complete,
    errors,
    tests,
  };
  await mkdir(dirname(resolve(target)), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`);
}
