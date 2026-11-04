import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createModel,
  evaluationCaseIds,
  evaluationFixtureHash,
  type ModelReceipt,
  type ModelUsage,
  modelUsage,
  type ProviderOptions,
  resolveProvider,
  runCost,
  runEvaluations,
} from "@prq/core";

export class EvaluationIssue extends Error {}

export async function evaluate(
  options: ProviderOptions & { live?: boolean; case?: string; timeout?: number; out?: string },
) {
  if (options.out && existsSync(resolve(options.out)))
    throw new EvaluationIssue("Evaluation output already exists. Choose a fresh path.");
  const ids = options.case && options.case !== "all" ? options.case.split(",") : evaluationCaseIds;
  if (
    !ids.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !evaluationCaseIds.includes(id))
  )
    throw new EvaluationIssue(`Choose case IDs from: ${evaluationCaseIds.join(", ")}`);
  const selection = options.live ? resolveProvider(options, process.env) : undefined;
  const result = await runEvaluations({
    caseIds: ids,
    ...(selection
      ? {
          live: () => {
            const usage: ModelUsage[] = [];
            const rows = new Map<string, ModelUsage>();
            const start = (stage: ModelUsage["stage"], model: string) => {
              const row = modelUsage({ stage, model, provider: selection.provider });
              rows.set(stage, row);
              usage.push(row);
            };
            const received = (stage: ModelUsage["stage"], model: string, receipt: ModelReceipt) => {
              const row = rows.get(stage);
              if (row)
                Object.assign(
                  row,
                  modelUsage({ stage, model, provider: selection.provider, receipt }),
                );
            };
            return {
              usage,
              coverage: {
                model: createModel(selection),
                timeoutMs: options.timeout,
                onRequest: (stage: "requirements" | "coverage") => start(stage, selection.model),
                onUsage: (stage: "requirements" | "coverage", receipt: ModelReceipt) =>
                  received(stage, selection.model, receipt),
              },
              judge: {
                ...(selection.decisionMode === "decisions"
                  ? { apiKey: selection.apiKey, model: selection.judgeModel }
                  : { languageModel: createModel({ ...selection, model: selection.judgeModel }) }),
                timeoutMs: options.timeout,
                onRequest: () => start("judge", selection.judgeModel),
                onUsage: (receipt: ModelReceipt) =>
                  received("judge", selection.judgeModel, receipt),
              },
            };
          },
        }
      : {}),
  });
  const usage = result.flatMap((row) => row.model_usage);
  const report = {
    format: "prq-eval/v1",
    id: randomUUID(),
    created_at: new Date().toISOString(),
    mode: options.live ? "live_judgment" : "deterministic",
    tool: {
      version: "0.2.0",
      executable_sha256: `sha256:${createHash("sha256")
        .update(await readFile(new URL(import.meta.url)))
        .digest("hex")}`,
    },
    fixture_set: "prq-core-loop/v1",
    fixture_hash: evaluationFixtureHash,
    ...(selection
      ? {
          configuration: {
            provider: selection.provider,
            model: selection.model,
            judge_model: selection.judgeModel,
            decision_mode: selection.decisionMode,
          },
        }
      : {}),
    scope:
      "Synthetic evidence and tasks. No application, browser, repository mutation or real provider-budget exhaustion. Deterministic mode measures safeguards, not model accuracy.",
    cases: result,
    summary: {
      total: result.length,
      matched: result.filter((r) => r.matched).length,
      mismatched: result.filter((r) => !r.matched).length,
      false_passes: result.filter((r) => r.false_pass).length,
      false_alarms: result.filter((r) => r.false_alarm).length,
      duration_ms: result.reduce((sum, row) => sum + row.duration_ms, 0),
      ...(!options.live
        ? { cost_usd: 0, reported_cost_usd: 0, cost_complete: true }
        : runCost(usage)),
    },
  };
  if (options.out) {
    const path = resolve(options.out);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  }
  return report;
}
