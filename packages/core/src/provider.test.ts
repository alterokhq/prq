import { generateText } from "ai";
import { describe, expect, it } from "vitest";
import { createModel, modelUsage, resolveProvider, runCost } from "./provider.js";

describe("provider selection", () => {
  it("supports direct OpenAI and an explicitly selected OpenRouter without leaking keys into metadata", () => {
    const env = {
      OPENAI_API_KEY: "test-direct",
      OPENROUTER_API_KEY: "test-router",
      PRQ_MODEL: "example/model",
    };
    expect(resolveProvider({}, env)).toMatchObject({ provider: "openai", apiKey: "test-direct" });
    expect(
      resolveProvider(
        { provider: "openrouter", model: "other/model", judgeModel: "judge/model" },
        env,
      ),
    ).toEqual({
      provider: "openrouter",
      apiKey: "test-router",
      model: "other/model",
      judgeModel: "judge/model",
      decisionMode: "structured",
    });
    expect(
      resolveProvider({}, { OPENROUTER_API_KEY: "test-router", PRQ_MODEL: "example/model" })
        .provider,
    ).toBe("openrouter");
  });
  it("preserves Decisions for OpenAI and requires an explicit structured opt-in", () => {
    const env = { OPENAI_API_KEY: "test-direct" };
    expect(resolveProvider({}, env)).toMatchObject({
      decisionMode: "decisions",
      judgeModel: "gpt-6-luna",
    });
    expect(resolveProvider({ decisionMode: "structured" }, env)).toMatchObject({
      decisionMode: "structured",
      judgeModel: "gpt-6.1-sol",
    });
    expect(() =>
      resolveProvider(
        { provider: "openrouter", model: "fixture", decisionMode: "decisions" },
        { OPENROUTER_API_KEY: "test-router" },
      ),
    ).toThrow("structured");
  });
  it("does not silently switch providers when a selected key is missing", () => {
    expect(() =>
      resolveProvider({ provider: "openrouter" }, { OPENAI_API_KEY: "test-direct" }),
    ).toThrow("OPENROUTER_API_KEY");
    expect(() => resolveProvider({}, { OPENROUTER_API_KEY: "test-router" })).toThrow("PRQ_MODEL");
    expect(() => resolveProvider({ provider: "unsupported" }, {})).toThrow("Choose --provider");
  });
});

describe("provider transport", () => {
  it.each(["openai", "openrouter"] as const)(
    "sends %s credentials only to that provider",
    async (provider) => {
      const calls: { url: string; authorization: string | null; body: unknown }[] = [];
      const model = createModel({
        provider,
        model: "fixture-model",
        apiKey: "test-only-credential",
        fetchImpl: async (url, init) => {
          calls.push({
            url: String(url),
            authorization: new Headers(init?.headers).get("authorization"),
            body: JSON.parse(String(init?.body)),
          });
          return new Response(
            JSON.stringify({
              error: {
                message: "fixture-denial",
                type: "invalid_request_error",
                code: "invalid_api_key",
              },
            }),
            { status: 401, headers: { "content-type": "application/json" } },
          );
        },
      });
      await expect(generateText({ model, prompt: "test", maxRetries: 0 })).rejects.toThrow();
      expect(calls).toHaveLength(1);
      expect(new URL(calls[0]?.url ?? "").hostname).toBe(
        provider === "openrouter" ? "openrouter.ai" : "api.openai.com",
      );
      expect(calls[0]?.authorization).toBe("Bearer test-only-credential");
      expect(calls[0]?.body).toMatchObject({ model: "fixture-model" });
    },
  );
  it("reads real OpenRouter SDK usage metadata without a live model call", async () => {
    const model = createModel({
      provider: "openrouter",
      model: "fixture/model",
      apiKey: "test-only",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            id: "gen-fixture",
            model: "fixture/model",
            object: "chat.completion",
            created: 1,
            choices: [
              { index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" },
            ],
            usage: { prompt_tokens: 12, completion_tokens: 2, total_tokens: 14, cost: 0.001 },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    });
    const result = await generateText({ model, prompt: "test", maxRetries: 0 });
    const row = modelUsage({
      stage: "extraction",
      provider: "openrouter",
      model: "fixture/model",
      receipt: result,
    });
    expect(row).toMatchObject({
      input_tokens: 12,
      output_tokens: 2,
      cost_usd: 0.001,
      status: "completed",
    });
  });
});

describe("honest accounting", () => {
  it("keeps unavailable costs distinct from zero and partial totals", () => {
    const unknown = modelUsage({
      stage: "judge",
      provider: "openai",
      model: "fixture",
      receipt: { usage: { inputTokens: 3, outputTokens: 2 } },
    });
    const free = modelUsage({
      stage: "extraction",
      provider: "openrouter",
      model: "fixture",
      receipt: { usage: {}, providerMetadata: { openrouter: { usage: { cost: 0 } } } },
    });
    expect(unknown.cost_usd).toBeNull();
    expect(runCost([free])).toEqual({ cost_usd: 0, reported_cost_usd: 0, cost_complete: true });
    expect(runCost([free, unknown])).toEqual({
      cost_usd: null,
      reported_cost_usd: 0,
      cost_complete: false,
    });
    expect(runCost([]).cost_usd).toBeNull();
    expect(JSON.stringify(unknown)).not.toContain("apiKey");
  });
});
