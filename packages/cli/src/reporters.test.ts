import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeTests, TestReport } from "@prq/core";
import { execa } from "execa";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const dependencies = fileURLToPath(new URL("../../../node_modules", import.meta.url));
const fixtures = [
  { name: "passed", body: 'test("works", () => expect(1).toBe(1));', expected: { passed: 1 } },
  { name: "failed", body: 'test("fails", () => expect(1).toBe(2));', expected: { failed: 1 } },
  { name: "skipped", body: 'test.skip("later", () => {});', expected: { skipped: 1, executed: 0 } },
  { name: "zero", body: "", expected: { executed: 0, total: 0 } },
  {
    name: "setup",
    body: 'BEFORE(() => { throw new Error("service unavailable"); }); test("works", () => expect(1).toBe(1));',
    expected: { error: 1, failed: 0 },
  },
  {
    name: "setup-assertion",
    body: 'EACH(() => { expect(1).toBe(2); }); test("works", () => expect(1).toBe(1));',
    expected: { error: 1, failed: 0 },
  },
  {
    name: "body-after-hook",
    body: 'EACH(() => {}); test("fails", () => expect(1).toBe(2));',
    expected: { failed: 1 },
  },
  {
    name: "expected_failed",
    body: 'FAIL("known failure", () => expect(1).toBe(2));',
    expected: { expected_failed: 1, passed: 0 },
  },
  {
    name: "unexpected-pass",
    body: 'FAIL("known failure", () => expect(1).toBe(1));',
    expected: { passed: 0 },
  },
  {
    name: "timeout",
    body: 'test("slow", async () => { await new Promise(resolve => setTimeout(resolve, 100)); });',
    expected: { passed: 0, failed: 0 },
  },
  {
    name: "flaky",
    body: 'test("retry", (CONTEXT) => { expect(RETRY).toBe(1); });',
    expected: { flaky: 1, passed: 0 },
  },
];
for (const framework of ["vitest", "playwright"] as const) {
  it.each(fixtures)(
    `${framework} preserves $name through its real runner`,
    async (fixture) => {
      const root = await mkdtemp(join(tmpdir(), "prq-reporter-"));
      try {
        await symlink(dependencies, join(root, "node_modules"), "dir");
        const reporter = fileURLToPath(new URL(`../dist/${framework}.js`, import.meta.url));
        const output = join(root, "report.json");
        const vitest = framework === "vitest";
        const prefix = vitest
          ? 'import { test, expect, beforeAll, beforeEach } from "vitest";\n'
          : 'import { test, expect } from "@playwright/test";\n';
        const body = fixture.body
          .replace("BEFORE", vitest ? "beforeAll" : "test.beforeAll")
          .replace("EACH", vitest ? "beforeEach" : "test.beforeEach")
          .replace("FAIL", vitest ? "test.fails" : "test.fail")
          .replace("CONTEXT", vitest ? "ctx" : "{}, info")
          .replace("RETRY", vitest ? "ctx.task.result.retryCount" : "info.retry");
        await writeFile(join(root, "sample.test.mjs"), prefix + body);
        await writeFile(
          join(root, "config.mjs"),
          `export default ${JSON.stringify(
            vitest
              ? {
                  test: {
                    include: ["sample.test.mjs"],
                    retry: fixture.name === "flaky" ? 1 : 0,
                    reporters: [reporter],
                    passWithNoTests: true,
                    testTimeout: fixture.name === "timeout" ? 25 : 5000,
                  },
                }
              : {
                  testMatch: "sample.test.mjs",
                  retries: fixture.name === "flaky" ? 1 : 0,
                  workers: 1,
                  timeout: fixture.name === "timeout" ? 25 : 5000,
                  reporter: [[reporter]],
                },
          )};`,
        );
        const execution = await execa(
          process.execPath,
          vitest
            ? [join(dependencies, "vitest/vitest.mjs"), "run", "--config", "config.mjs"]
            : [
                require.resolve("@playwright/test/cli"),
                "test",
                "--config",
                "config.mjs",
                "--pass-with-no-tests",
              ],
          {
            cwd: root,
            reject: false,
            timeout: 25000,
            env: { PRQ_TEST_REPORT: output, PRQ_RUN_TOKEN: "fixture-run", CI: "1" },
          },
        );
        const report = TestReport.parse(JSON.parse(await readFile(output, "utf8")));
        expect(report.run_token, execution.stderr).toBe("fixture-run");
        const summary = summarizeTests(report);
        if (fixture.name === "setup") {
          expect(summary.failed).toBe(0);
          expect(summary.error + summary.errors).toBeGreaterThan(0);
        } else expect(summary, execution.stderr).toMatchObject(fixture.expected);
        expect(report.complete).toBe(true);
        if (fixture.name === "flaky") expect(report.tests[0]?.attempts).toBe(2);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    30000,
  );
}
