import { describe, expect, it } from "vitest";
import { testCounts } from "./command-summary.js";
import { judgeClaims } from "./judge.js";
import type { DraftClaim } from "./schema.js";

const claim: DraftClaim = { id: "c1", text: "All 12 tests ran.", kind: "command" };
describe("recognized test counts", () => {
  it.each([
    ["# tests 12\n# pass 0\n# fail 0\n# skipped 12", "tap"],
    ["ℹ tests 12\nℹ pass 0\nℹ fail 0\nℹ skipped 12", "node_test"],
    ["Tests 0 passed | 12 skipped (12)", "vitest"],
    ["Tests: 12 skipped, 12 total", "jest"],
    ["0 tests run, 12 skipped", "plain"],
  ])("reads numeric observations from %s", (output, format) => {
    expect(testCounts(output)).toContainEqual({ format, metric: "skipped", count: 12 });
  });
  it("does not forward codeframes or accept an arbitrary source line as a summary", () => {
    const output =
      '12 | const secret = "private implementation";\nconsole.log("Tests 12 passed")\nTests 0 passed | 12 skipped (12)';
    const summary = testCounts(output);
    expect(summary).toHaveLength(3);
    expect(JSON.stringify(summary)).not.toContain("private");
    expect(summary).not.toContainEqual({ format: "vitest", metric: "passed", count: 12 });
  });
  it("rejects a summary with arbitrary trailing content", () => {
    expect(testCounts("Tests: 12 passed; const secret = 1")).toEqual([]);
  });
  it("does not promote console counts to structured evidence", async () => {
    let called = false;
    const out = await judgeClaims(
      [
        {
          claim,
          result: {
            passed: true,
            evidence: [{ type: "command", exit_code: 0, stdout: "12 tests run, 0 skipped" }],
            tester: "shell",
            duration_ms: 1,
          },
        },
      ],
      {
        apiKey: "fixture",
        fetchImpl: async () => {
          called = true;
          return new Response("{}");
        },
      },
    );
    expect(out.get("c1")?.verdict).toBe("unverified");
    expect(called).toBe(false);
  });
  it("leaves a count claim unverified when only exit status is available", async () => {
    let called = false;
    const out = await judgeClaims(
      [
        {
          claim,
          result: {
            passed: true,
            evidence: [
              { type: "command", command: "npm run test", exit_code: 0, stdout: "completed" },
            ],
            tester: "shell",
            duration_ms: 1,
          },
        },
      ],
      {
        apiKey: "fixture",
        fetchImpl: async () => {
          called = true;
          return new Response("{}");
        },
      },
    );
    expect(called).toBe(false);
    expect(out.get("c1")?.verdict).toBe("unverified");
  });
});
