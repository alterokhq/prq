import { createHash } from "node:crypto";
import type { LanguageModel } from "ai";
import {
  assessTaskCoverage,
  type CoverageOptions,
  coverageIssues,
  plannedClaims,
} from "./coverage.js";
import type { TaskCoverage } from "./coverage-schema.js";
import type { DecisionsOptions } from "./decisions.js";
import { type JudgeInput, type Judgment, judgeClaims } from "./judge.js";
import { lockClaims } from "./lock.js";
import { createModel } from "./provider.js";
import type { DraftClaim, ModelUsage, Verdict } from "./schema.js";
import { summarizeTests } from "./test-results.js";

export type EvaluationOutcome =
  | Verdict
  | "coverage_complete"
  | "coverage_gap"
  | "coverage_unavailable";
type JudgmentCase = {
  id: string;
  kind: "judgment";
  expected: Verdict;
  input: JudgeInput;
  fault?: "budget";
};
type CoverageCase = {
  id: string;
  kind: "coverage";
  expected: "coverage_complete" | "coverage_gap";
  task: string;
  claims: DraftClaim[];
  commands: string[];
  responses: unknown[];
};
type EvaluationCase = JudgmentCase | CoverageCase;
const suite: DraftClaim = {
  id: "c1",
  text: "All tests pass.",
  kind: "command",
  check: { command: "npm test" },
};
function suiteInput(statuses: ("passed" | "failed")[]): JudgeInput {
  return {
    claim: suite,
    result: {
      passed: !statuses.includes("failed"),
      tester: "evaluation fixture",
      duration_ms: 0,
      evidence: [
        {
          type: "command",
          exit_code: statuses.includes("failed") ? 1 : 0,
          test_summary: summarizeTests({
            format: "prq-test-results/v1",
            framework: "fixture",
            run_token: "fixture",
            complete: true,
            errors: 0,
            tests: statuses.map((status) => ({
              name: "fixture assertion",
              status,
              attempts: 1,
              attachments: [],
            })),
          }),
        },
      ],
    },
  };
}
const search = "Search matches case-insensitively.";
const empty = "Show an empty state for no matches.";
const searchClaim: DraftClaim = { id: "search", text: search, kind: "browser" };
const plannedSearch = {
  claim_id: "search",
  kind: "browser",
  check: { path: "/", setup: "Type an uppercase version of a visible item title", command: null },
  reason: "Observe the search interaction.",
};
// Fixed synthetic model transcripts exercise transport and validators. They are not measured accuracy.
const coveredSearch = {
  requirement_id: "r1",
  status: "covered",
  claim_ids: ["search"],
  reason: "The claim explicitly promises the requirement.",
};
const cases: EvaluationCase[] = [
  { id: "known-good", kind: "judgment", expected: "held", input: suiteInput(["passed"]) },
  { id: "seeded-defect", kind: "judgment", expected: "broken", input: suiteInput(["failed"]) },
  { id: "zero-tests", kind: "judgment", expected: "unverified", input: suiteInput([]) },
  {
    id: "unknown-counts",
    kind: "judgment",
    expected: "unverified",
    input: {
      claim: suite,
      result: {
        passed: true,
        tester: "fixture",
        duration_ms: 0,
        evidence: [{ type: "command", exit_code: 0 }],
      },
    },
  },
  {
    id: "missing-service",
    kind: "judgment",
    expected: "unverified",
    input: {
      claim: { id: "c1", text: "Search works.", kind: "browser" },
      result: {
        tester: "fixture",
        duration_ms: 0,
        evidence: [{ type: "note", text: "Required service did not start." }],
      },
    },
  },
  {
    id: "unsupported-behavior",
    kind: "judgment",
    expected: "unverified",
    input: {
      ...suiteInput(["passed"]),
      claim: { ...suite, text: "Login rejects incorrect passwords." },
    },
  },
  {
    id: "provider-budget",
    kind: "judgment",
    expected: "unverified",
    input: suiteInput(["passed"]),
    fault: "budget",
  },
  {
    id: "covered-task",
    kind: "coverage",
    expected: "coverage_complete",
    task: search,
    claims: [searchClaim],
    commands: [],
    responses: [
      { requirements: [search] },
      { requirements: [coveredSearch], checks: [plannedSearch] },
    ],
  },
  {
    id: "omitted-requirement",
    kind: "coverage",
    expected: "coverage_gap",
    task: `${search}\n${empty}`,
    claims: [searchClaim],
    commands: [],
    responses: [
      { requirements: [search, empty] },
      {
        requirements: [
          coveredSearch,
          {
            requirement_id: "r2",
            status: "missing",
            claim_ids: [],
            reason: "The builder omitted the empty-state promise.",
          },
        ],
        checks: [plannedSearch],
      },
    ],
  },
];
export const evaluationCaseIds = cases.map((c) => c.id);
export const evaluationFixtureHash = `sha256:${createHash("sha256").update(JSON.stringify(cases)).digest("hex")}`;

/** Real SDK parsing, intercepted transport; never sends a network request. */
export function evaluationFixtureModel(responses: readonly unknown[]): LanguageModel {
  let index = 0;
  return createModel({
    provider: "openrouter",
    model: "fixture/model",
    apiKey: "fixture-only-unused",
    fetchImpl: async () => {
      if (index >= responses.length) throw new Error("Fixture responses exhausted");
      return new Response(
        JSON.stringify({
          id: "fixture",
          model: "fixture/model",
          object: "chat.completion",
          created: 1,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: JSON.stringify(responses[index++]) },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  });
}
type EvaluationObservation =
  | { kind: "judgment"; judgment: Judgment; evidence: JudgeInput; actual: Judgment["verdict"] }
  | {
      kind: "coverage";
      coverage: TaskCoverage;
      task: string;
      claims: DraftClaim[];
      actual: "coverage_complete" | "coverage_gap" | "coverage_unavailable";
    };
export type EvaluationResult = EvaluationObservation & {
  id: string;
  execution: "synthetic" | "live_judgment" | "fault_injection";
  expected: EvaluationOutcome;
  matched: boolean;
  false_pass: boolean;
  false_alarm: boolean;
  duration_ms: number;
  model_usage: ModelUsage[];
};
export interface EvaluationModels {
  judge: DecisionsOptions;
  coverage: CoverageOptions;
  usage: ModelUsage[];
}
export async function runEvaluations(
  options: { caseIds?: readonly string[]; live?: () => EvaluationModels } = {},
): Promise<EvaluationResult[]> {
  const ids = options.caseIds ?? evaluationCaseIds;
  if (
    !ids.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !evaluationCaseIds.includes(id))
  )
    throw new Error("Choose unique known evaluation case IDs.");
  const results: EvaluationResult[] = [];
  for (const id of ids) {
    const fixture = cases.find((c) => c.id === id);
    if (!fixture) throw new Error("Unknown case");
    const started = Date.now();
    const fault = fixture.kind === "judgment" && fixture.fault === "budget";
    const models = fault ? undefined : options.live?.();
    let observation: EvaluationObservation;
    if (fixture.kind === "judgment") {
      const judge = models?.judge ?? {
        apiKey: "fixture-only-unused",
        fetchImpl: async () =>
          fault
            ? new Response("Synthetic budget exhaustion", { status: 402 })
            : new Response(
                JSON.stringify({ answers: [{ type: "predicate", name: "c1", probability: 1 }] }),
              ),
      };
      const judgment = (await judgeClaims([fixture.input], judge)).get(fixture.input.claim.id) ?? {
        verdict: "unverified",
      };
      observation = {
        kind: "judgment",
        judgment,
        evidence: fixture.input,
        actual: judgment.verdict,
      };
    } else {
      const coverage = await assessTaskCoverage(
        { task: fixture.task, claims: fixture.claims, commands: fixture.commands },
        models?.coverage ?? { model: evaluationFixtureModel(fixture.responses) },
      );
      const claims = plannedClaims(fixture.claims, coverage).map((claim) => ({
        ...claim,
        verdict: "held" as const,
      }));
      // Held rows here isolate coverage policy. They are not execution results or returned as proof.
      const issues = coverageIssues({
        handoff: { format: "prq-claims/v1", task: fixture.task, unfinished: [] },
        coverage,
        claims,
        source: { kind: "file", text: "fixture", hash: lockClaims(claims) },
      });
      const actual =
        coverage.status === "unavailable"
          ? "coverage_unavailable"
          : issues.length
            ? "coverage_gap"
            : "coverage_complete";
      observation = {
        kind: "coverage",
        coverage,
        task: fixture.task,
        claims: fixture.claims,
        actual,
      };
    }
    const { actual } = observation;
    const positive = (outcome: EvaluationOutcome) =>
      outcome === "held" || outcome === "coverage_complete";
    results.push({
      id,
      ...observation,
      execution: fault ? "fault_injection" : options.live ? "live_judgment" : "synthetic",
      expected: fixture.expected,
      matched: actual === fixture.expected,
      false_pass: positive(actual) && !positive(fixture.expected),
      false_alarm: positive(fixture.expected) && (actual === "broken" || actual === "coverage_gap"),
      duration_ms: Date.now() - started,
      model_usage: models?.usage ?? [],
    });
  }
  return results;
}
