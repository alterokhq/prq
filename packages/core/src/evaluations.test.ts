import { expect, it } from "vitest";
import { evaluationCaseIds, evaluationFixtureModel, runEvaluations } from "./evaluations.js";

it("runs the fixed safeguards without credentials and preserves expected/actual outcomes", async () => {
  const results = await runEvaluations();
  expect(results.map((r) => r.id)).toEqual(evaluationCaseIds);
  expect(results.every((r) => r.matched)).toBe(true);
  expect(results.every((r) => !r.false_pass && !r.false_alarm)).toBe(true);
  expect(results.every((r) => r.model_usage.length === 0)).toBe(true);
  expect(results.find((r) => r.id === "provider-budget")).toMatchObject({
    actual: "unverified",
    execution: "fault_injection",
  });
  expect(results.find((r) => r.id === "omitted-requirement")).toMatchObject({
    actual: "coverage_gap",
  });
});
it("counts missed requirements and false alarms rather than letting the judge define success", async () => {
  const results = await runEvaluations({
    caseIds: ["omitted-requirement", "known-good"],
    live: () => ({
      usage: [],
      coverage: {
        model: evaluationFixtureModel([
          { requirements: ["Search matches case-insensitively."] },
          {
            requirements: [
              {
                requirement_id: "r1",
                status: "covered",
                claim_ids: ["search"],
                reason: "Synthetic omission",
              },
            ],
            checks: [
              {
                claim_id: "search",
                kind: "browser",
                check: { path: "/", setup: null, command: null },
                reason: "Observe matching",
              },
            ],
          },
        ]),
      },
      judge: {
        apiKey: "unused",
        fetchImpl: async () =>
          new Response(
            JSON.stringify({ answers: [{ name: "c1", type: "predicate", probability: 0 }] }),
          ),
      },
    }),
  });
  expect(results[0]).toMatchObject({
    matched: false,
    false_pass: true,
    actual: "coverage_complete",
    expected: "coverage_gap",
  });
  expect(results[1]).toMatchObject({
    matched: false,
    false_alarm: true,
    actual: "broken",
    expected: "held",
  });
});
it("rejects unknown or duplicate cases before requesting a model", async () => {
  await expect(runEvaluations({ caseIds: ["unknown"] })).rejects.toThrow("known");
  await expect(runEvaluations({ caseIds: ["known-good", "known-good"] })).rejects.toThrow("unique");
});
