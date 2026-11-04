import { MockLanguageModelV4 } from "ai/test";
import { expect, it } from "vitest";
import { assessTaskCoverage, coverageIssues, coverageSummary, plannedClaims } from "./coverage.js";
import type { TaskCoverage } from "./coverage-schema.js";
import { verificationExitCode } from "./handoff.js";
import { lockClaims } from "./lock.js";
import type { DraftClaim, ProofRequest } from "./schema.js";

const task = "Search ignores case. Empty results show a message.";
const claims: DraftClaim[] = [
  {
    id: "c1",
    text: "Search ignores case.",
    kind: "command",
    check: { command: "builder-secret-recipe" },
  },
];
const mapping = {
  requirements: [
    { requirement_id: "r1", status: "covered", claim_ids: ["c1"], reason: "Explicit promise" },
    { requirement_id: "r2", status: "missing", claim_ids: [], reason: "Omitted promise" },
  ],
  checks: [
    {
      claim_id: "c1",
      kind: "browser",
      check: { path: "/", setup: "Type an uppercase version of a visible title", command: null },
      reason: "Observe actual matching",
    },
  ],
};
function responses(outputs: unknown[]) {
  let index = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify(outputs[index++]) }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 10, text: 10, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}
function model(output: unknown = mapping) {
  return responses([
    { requirements: ["Search ignores case.", "Empty results show a message."] },
    output,
  ]);
}
function proof(coverage: TaskCoverage): ProofRequest {
  const routed = plannedClaims(claims, coverage);
  return {
    version: "0.2",
    id: "fixture",
    created_at: "2026-01-01T00:00:00Z",
    subject: { head: "fixture" },
    source: { kind: "file", text: claims.map((c) => c.text).join(" "), hash: lockClaims(claims) },
    claims: routed.map((c) => ({ ...c, verdict: "held" })),
    summary: { held: 1, broken: 0, needs_human: 0, unverified: 0 },
    handoff: { format: "prq-claims/v1", task, unfinished: [] },
    coverage,
  };
}
it("extracts requirements in isolation, chooses independent checks and keeps the claim lock", async () => {
  const languageModel = model();
  const stages: string[] = [];
  const receipts: string[] = [];
  const audit = await assessTaskCoverage(
    { task, claims, commands: [] },
    {
      model: languageModel,
      onRequest: (stage) => stages.push(stage),
      onUsage: (stage) => receipts.push(stage),
    },
  );
  expect(audit.status).toBe("assessed");
  expect(stages).toEqual(["requirements", "coverage"]);
  expect(receipts).toEqual(stages);
  expect(JSON.stringify(languageModel.doGenerateCalls[0]?.prompt)).not.toContain("c1");
  expect(JSON.stringify(languageModel.doGenerateCalls)).not.toContain("builder-secret-recipe");
  const routed = plannedClaims(claims, audit);
  expect(routed[0]).toMatchObject({
    id: "c1",
    text: claims[0]?.text,
    kind: "browser",
    check: { path: "/" },
  });
  expect(lockClaims(routed)).toBe(lockClaims(claims));
  const pr = proof(audit);
  expect(coverageIssues(pr)).toEqual(["Requirement r2 is missing: Empty results show a message."]);
  expect(verificationExitCode(pr, true)).toBe(2);
  expect(verificationExitCode(pr)).toBe(0);
  expect(coverageSummary(pr)).toContain("1 missing");
});
it("keeps unavailable and empty task input explicit, without a request", async () => {
  const languageModel = model();
  const audit = await assessTaskCoverage({ claims, commands: [] }, { model: languageModel });
  expect(audit).toEqual({ status: "not_requested" });
  expect(languageModel.doGenerateCalls).toHaveLength(0);
});
it.each([
  { requirements: [] },
  { requirements: ["SEARCH ignores case."] },
  { requirements: ["Search ignores case.", "Search ignores case."] },
])("rejects empty, rewritten or duplicate requirements", async (output) => {
  const languageModel = responses([output]);
  const audit = await assessTaskCoverage({ task, claims, commands: [] }, { model: languageModel });
  expect(audit.status).toBe("unavailable");
  expect(languageModel.doGenerateCalls).toHaveLength(1);
});
it.each([
  { ...mapping, requirements: mapping.requirements.slice(0, 1) },
  { ...mapping, requirements: [mapping.requirements[0], mapping.requirements[0]] },
  {
    ...mapping,
    requirements: [
      { ...mapping.requirements[0], claim_ids: ["invented"] },
      mapping.requirements[1],
    ],
  },
  {
    ...mapping,
    requirements: [{ ...mapping.requirements[0], claim_ids: [] }, mapping.requirements[1]],
  },
  { ...mapping, checks: [] },
  {
    ...mapping,
    checks: [
      {
        ...mapping.checks[0],
        kind: "command",
        check: { command: "not-allowed", path: null, setup: null },
      },
    ],
  },
  {
    ...mapping,
    checks: [
      { ...mapping.checks[0], check: { command: null, path: "//external.example", setup: null } },
    ],
  },
])("rejects incomplete mappings and unsafe or invented check references", async (output) => {
  const audit = await assessTaskCoverage({ task, claims, commands: [] }, { model: model(output) });
  expect(audit.status).toBe("unavailable");
  expect(audit.status !== "not_requested" && audit.requirements).toHaveLength(2);
});
it("retains extracted requirements and safe diagnostics after provider exhaustion", async () => {
  const languageModel = new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error("private provider body and credential");
    },
  });
  const previous = await assessTaskCoverage({ task, claims, commands: [] }, { model: model() });
  const audit = await assessTaskCoverage(
    { task, claims, commands: [], previous },
    { model: languageModel },
  );
  expect(audit).toMatchObject({ status: "unavailable" });
  expect(audit.status !== "not_requested" && audit.requirements).toHaveLength(2);
  expect(JSON.stringify(audit)).not.toContain("private");
  expect(verificationExitCode(proof(audit), true)).toBe(2);
  expect(languageModel.doGenerateCalls).toHaveLength(1);
});
it("does not drop a previously known requirement when extraction misses it on rerun", async () => {
  const previous = await assessTaskCoverage({ task, claims, commands: [] }, { model: model() });
  const next = await assessTaskCoverage(
    { task, claims, commands: [], previous },
    { model: responses([{ requirements: ["Search ignores case."] }, mapping]) },
  );
  expect(next.status).toBe("assessed");
  expect(next.status === "assessed" && next.requirements).toHaveLength(2);
  expect(verificationExitCode(proof(next), true)).toBe(2);
});
it("requires a matching assessment on old reports and after task changes", async () => {
  const audit = await assessTaskCoverage({ task, claims, commands: [] }, { model: model() });
  const pr = proof(audit);
  pr.coverage = undefined;
  expect(coverageIssues(pr)[0]).toContain("not assessed");
  pr.coverage = audit;
  if (!pr.handoff) throw new Error("fixture");
  pr.handoff.task += " Another condition.";
  expect(coverageIssues(pr)[0]).toContain("does not match");
});
it("blocks unavailable independent checks even when claims are marked held", async () => {
  const audit = await assessTaskCoverage(
    { task, claims, commands: [] },
    {
      model: model({
        ...mapping,
        checks: [{ claim_id: "c1", kind: null, check: null, reason: "No relevant check" }],
      }),
    },
  );
  expect(coverageIssues(proof(audit)).join("\n")).toContain("No independent check selected");
});
