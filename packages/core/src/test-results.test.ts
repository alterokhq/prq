import { expect, it } from "vitest";
import { fixPrompt } from "./fix-prompt.js";
import { judgeClaims } from "./judge.js";
import { ProofRequest } from "./schema.js";
import { summarizeTests, type TestCaseResult, TestReport } from "./test-results.js";
import { tokenCount } from "./tokens.js";

function report(statuses: TestCaseResult["status"][], complete = true, errors = 0) {
  return TestReport.parse({
    format: "prq-test-results/v1",
    framework: "fixture",
    run_token: "fresh",
    complete,
    errors,
    tests: statuses.map((status) => ({
      name: "check",
      status,
      attempts: status === "flaky" ? 2 : 1,
    })),
  });
}
it.each([
  [[], true, 0],
  [["skipped"], true, 0],
  [["passed", "skipped"], true, 0],
  [["passed", "todo"], true, 0],
  [["flaky"], true, 0],
  [["expected_failed"], true, 0],
  [["passed", "unknown"], true, 0],
  [["passed", "interrupted"], true, 0],
  [["error"], true, 0],
  [["passed"], false, 0],
  [["passed"], true, 1],
] satisfies [TestCaseResult["status"][], boolean, number][])(
  "blocks optimistic judgment of %j (complete %s, errors %s)",
  async (statuses, complete, errors) => {
    let called = false;
    const judgments = await judgeClaims(
      [
        {
          claim: { id: "suite", text: "All tests pass.", kind: "command" },
          result: {
            passed: true,
            tester: "shell",
            duration_ms: 1,
            evidence: [
              {
                type: "command",
                exit_code: 0,
                test_summary: summarizeTests(report(statuses, complete, errors)),
              },
            ],
          },
        },
      ],
      {
        apiKey: "fixture",
        fetchImpl: async () => {
          called = true;
          return new Response(
            JSON.stringify({ answers: [{ type: "predicate", name: "suite", probability: 1 }] }),
          );
        },
      },
    );
    expect(judgments.get("suite")?.verdict).toBe("unverified");
    expect(called).toBe(false);
  },
);
it.each([0, 1])(
  "retains genuine failed assertions at exit %s without consulting a model",
  async (exit) => {
    const judgments = await judgeClaims([
      {
        claim: { id: "suite", text: "All tests pass.", kind: "command" },
        result: {
          passed: exit === 0,
          tester: "shell",
          duration_ms: 1,
          evidence: [
            {
              type: "command",
              exit_code: exit,
              test_summary: summarizeTests(report(["passed", "failed", "skipped"])),
            },
          ],
        },
      },
    ]);
    expect(judgments.get("suite")?.verdict).toBe("broken");
  },
);
it("judges a fully passing suite using counts without source or test names", async () => {
  let request = "";
  const judgments = await judgeClaims(
    [
      {
        claim: { id: "suite", text: "All tests pass.", kind: "command" },
        result: {
          passed: true,
          tester: "shell",
          duration_ms: 1,
          evidence: [
            {
              type: "command",
              exit_code: 0,
              stdout: "private code",
              test_summary: summarizeTests(report(["passed"])),
            },
          ],
        },
      },
    ],
    {
      apiKey: "fixture",
      fetchImpl: async (_url, init) => {
        request = String(init?.body);
        return new Response(
          JSON.stringify({ answers: [{ type: "predicate", name: "suite", probability: 1 }] }),
        );
      },
    },
  );
  expect(judgments.get("suite")?.verdict).toBe("held");
  expect(request).toContain("test_summary");
  expect(request).not.toContain("private code");
});
it.each(["Login works.", "All tests pass."])(
  "does not treat an arbitrary command failure as proof against %s",
  async (text) => {
    const judgments = await judgeClaims([
      {
        claim: { id: "suite", text, kind: "command" },
        result: {
          passed: false,
          tester: "shell",
          duration_ms: 1,
          evidence: [{ type: "command", exit_code: 1 }],
        },
      },
    ]);
    expect(judgments.get("suite")?.verdict).toBe("unverified");
  },
);
it("rejects zero-attempt success and retries mislabeled as a clean pass", () => {
  const base = report(["passed"]);
  for (const attempts of [0, 2])
    expect(TestReport.safeParse({ ...base, tests: [{ ...base.tests[0], attempts }] }).success).toBe(
      false,
    );
});
it("includes rejected human signoff without weakening the locked claim", () => {
  const pr = ProofRequest.parse({
    version: "0.2",
    id: "run-one",
    created_at: "2026-01-01T00:00:00Z",
    subject: { head: "fixture" },
    source: { kind: "file", text: "Layout is clear.", hash: "sha256:1234567" },
    summary: { held: 0, broken: 0, needs_human: 1, unverified: 0 },
    claims: [
      {
        id: "layout",
        text: "Layout is clear.",
        kind: "human",
        verdict: "needs_human",
        signoff: {
          by: "Reviewer",
          decision: "rejected",
          reason: "Labels overlap",
          at: "2026-01-01T00:00:00Z",
        },
      },
    ],
  });
  const prompt = fixPrompt(pr);
  expect(prompt).toContain("Layout is clear.");
  expect(prompt).toContain("rejected by Reviewer: Labels overlap");
  expect(prompt).toContain("prq rerun --run .pr/runs/run-one/proof-request.json");
  expect(tokenCount(prompt)).toBeLessThan(300);
});
