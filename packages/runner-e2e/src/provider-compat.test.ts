import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createModel } from "@prq/core";
import { describe, expect, it, vi } from "vitest";
import { e2eRunner } from "./index.js";

const require = createRequire(import.meta.url);
// Pin this test to the real runner adapter. Loading configuration alone cannot
// establish that its SDK can invoke the model instances shipped by prq.
const adapterPath = join(dirname(require.resolve("e2e")), "agent/model/sdk.js");
const { createModelAdapter } = await import(pathToFileURL(adapterPath).href);

describe("e2e 0.22 provider compatibility", () => {
  it.each(["openai", "openrouter"] as const)(
    "invokes prq's %s model through the real e2e adapter",
    async (provider) => {
      let calls = 0;
      const model = createModel({
        provider,
        model: "fixture-model",
        apiKey: "test-only",
        fetchImpl: async (_url, init) => {
          calls++;
          expect(JSON.parse(String(init?.body)).model).toBe("fixture-model");
          const text = JSON.stringify({ accepted: true });
          const response =
            provider === "openrouter"
              ? {
                  id: "gen-fixture",
                  model: "fixture-model",
                  object: "chat.completion",
                  created: 1,
                  choices: [
                    {
                      index: 0,
                      message: { role: "assistant", content: text },
                      finish_reason: "stop",
                    },
                  ],
                  usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
                }
              : {
                  id: "resp_fixture",
                  model: "fixture-model",
                  object: "response",
                  created_at: 1,
                  status: "completed",
                  output: [
                    {
                      type: "message",
                      id: "msg_fixture",
                      role: "assistant",
                      status: "completed",
                      content: [{ type: "output_text", text, annotations: [] }],
                    },
                  ],
                  usage: { input_tokens: 12, output_tokens: 5, total_tokens: 17 },
                };
          return new Response(JSON.stringify(response), {
            headers: { "content-type": "application/json" },
          });
        },
      });
      const adapter = createModelAdapter({ model, provider, id: "fixture-model" }, "prq");
      const result = await adapter.generate({
        system: "Return the fixture result.",
        prompt: "Check the fixture.",
        schemaName: "fixture",
        schema: {
          type: "object",
          properties: { accepted: { type: "boolean" } },
          required: ["accepted"],
          additionalProperties: false,
        },
        validate: (value: unknown) =>
          typeof value === "object" &&
          value !== null &&
          "accepted" in value &&
          value.accepted === true
            ? { ok: true, value }
            : { ok: false, issue: "invalid fixture" },
        maxInputTokens: 1000,
        maxOutputTokens: 100,
        timeoutMs: 1000,
        signal: AbortSignal.timeout(1000),
      });
      expect(result.value).toEqual({ accepted: true });
      expect(result.usage.inputTokens).toBe(12);
      expect(calls).toBe(1);
    },
  );
  it("does not record an external model stage when the application is unavailable", async () => {
    const started = vi.fn();
    vi.stubGlobal("fetch", async () => new Response("unavailable", { status: 503 }));
    try {
      const results = await e2eRunner.run(
        [{ id: "c1", text: "The page works.", kind: "browser" }],
        {
          worktree: "/unused",
          runDir: "/unused",
          appUrl: "http://fixture.invalid",
          timeoutMs: 100,
          onBrowserStart: started,
        },
      );
      expect(results.get("c1")?.passed).toBeUndefined();
      expect(started).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
