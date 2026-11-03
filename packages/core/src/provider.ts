import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { ModelUsage, ProofRequest } from "./schema.js";

export const ProviderName = z.enum(["openai", "openrouter"]);
export type ProviderName = z.infer<typeof ProviderName>;
export class ProviderConfigurationIssue extends Error {}

export interface ProviderOptions {
  provider?: string;
  model?: string;
  judgeModel?: string;
}

/** Environment is supplied by the caller; core never reads deployment secrets. */
export function resolveProvider(options: ProviderOptions, env: Record<string, string | undefined>) {
  const selection =
    options.provider ??
    env.PRQ_PROVIDER ??
    (env.OPENROUTER_API_KEY && !env.OPENAI_API_KEY ? "openrouter" : "openai");
  const parsed = ProviderName.safeParse(selection);
  if (!parsed.success)
    throw new ProviderConfigurationIssue(
      "Choose --provider openai or openrouter (or PRQ_PROVIDER).",
    );
  const provider = parsed.data;
  const keyName = provider === "openrouter" ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY";
  const apiKey = env[keyName]?.trim();
  if (!apiKey) throw new ProviderConfigurationIssue(`Set ${keyName} before running verification.`);
  const model = (
    options.model ??
    env.PRQ_MODEL ??
    (provider === "openai" ? "gpt-6.1-sol" : "")
  ).trim();
  if (!model)
    throw new ProviderConfigurationIssue(
      "Set --model or PRQ_MODEL to a model available through the selected provider.",
    );
  const judgeModel = (options.judgeModel ?? env.PRQ_JUDGE_MODEL ?? model).trim();
  if (!judgeModel) throw new ProviderConfigurationIssue("The judge model must not be empty.");
  return { provider, model, judgeModel, apiKey };
}

export function createModel(options: {
  provider: ProviderName;
  model: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): LanguageModel {
  const settings = { apiKey: options.apiKey, fetch: options.fetchImpl };
  return options.provider === "openrouter"
    ? createOpenRouter(settings)(options.model)
    : createOpenAI(settings)(options.model);
}

export interface ModelReceipt {
  usage: { inputTokens?: number; outputTokens?: number };
  providerMetadata?: unknown;
}
const RouterMetadata = z.object({
  openrouter: z.object({ usage: z.object({ cost: z.number().finite().nonnegative().optional() }) }),
});

/** Only allowlisted accounting fields enter an artifact, never response bodies or keys. */
export function modelUsage(options: {
  stage: ModelUsage["stage"];
  provider: ProviderName;
  model: string;
  receipt?: ModelReceipt;
}): ModelUsage {
  const metadata = RouterMetadata.safeParse(options.receipt?.providerMetadata);
  return {
    stage: options.stage,
    provider: options.provider,
    model: options.model,
    status: options.receipt ? "completed" : "unavailable",
    input_tokens: options.receipt?.usage.inputTokens ?? null,
    output_tokens: options.receipt?.usage.outputTokens ?? null,
    cost_usd:
      options.provider === "openrouter" && metadata.success
        ? (metadata.data.openrouter.usage.cost ?? null)
        : null,
  };
}

export function runCost(
  usage: ModelUsage[],
): Pick<NonNullable<ProofRequest["timing"]>, "cost_usd" | "reported_cost_usd" | "cost_complete"> {
  const known = usage.flatMap((row) => (row.cost_usd === null ? [] : [row.cost_usd]));
  const reported = known.length ? known.reduce((sum, cost) => sum + cost, 0) : null;
  const complete = usage.length > 0 && known.length === usage.length;
  return {
    cost_usd: complete ? reported : null,
    reported_cost_usd: reported,
    cost_complete: complete,
  };
}
