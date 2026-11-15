import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { decide } from "./decisions.js";
import { judgeClaims } from "./judge.js";
import { createModel } from "./provider.js";

function model(answers: unknown[]) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify({ answers }) }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 10, text: 10, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

describe("provider-independent judgment", () => {
  it("matches answers by name, carries images, and records usage", async () => {
    const languageModel = model([{ type: "predicate", name: "c1", probability: 0.9 }]);
    let usage = false;
    const answers = await decide(
      "Judge evidence",
      [
        {
          type: "predicate",
          name: "c1",
          instructions: [
            { type: "input_text", text: "Check the screenshot" },
            { type: "input_image", image_url: "data:image/png;base64,aGVsbG8=" },
          ],
        },
      ],
      {
        languageModel,
        onUsage: () => {
          usage = true;
        },
      },
    );
    expect(answers[0]).toMatchObject({ name: "c1", probability: 0.9 });
    expect(usage).toBe(true);
    expect(JSON.stringify(languageModel.doGenerateCalls[0]?.prompt)).toContain('"type":"file"');
    expect(JSON.stringify(languageModel.doGenerateCalls[0]?.prompt)).toContain("aGVsbG8=");
  });
  it.each([
    [
      { type: "predicate", name: "c1", probability: 1 },
      { type: "predicate", name: "c1", probability: 1 },
    ],
    [{ type: "predicate", name: "unknown", probability: 1 }],
    [{ type: "choice", name: "c1", choice: "browser", confidence: 1 }],
  ])("rejects malformed answer matching", async (...answers) => {
    await expect(
      decide("judge", [{ type: "predicate", name: "c1", instructions: "check" }], {
        languageModel: model(answers),
      }),
    ).rejects.toThrow("Decisions returned");
  });
  it("keeps supported checks unverified when the provider budget is exhausted", async () => {
    const languageModel = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("provider budget exhausted, private response details");
      },
    });
    let calls = 0;
    const out = await judgeClaims(
      [
        {
          claim: { id: "c1", text: "Search works.", kind: "browser" },
          result: {
            passed: true,
            evidence: [{ type: "assertion", passed: true }],
            tester: "fixture",
            duration_ms: 1,
          },
          screenshotDataUrl: "data:image/png;base64,aGVsbG8=",
        },
      ],
      {
        languageModel,
        onRequest: () => {
          calls++;
        },
      },
    );
    expect(out.get("c1")).toMatchObject({ verdict: "unverified" });
    expect(JSON.stringify([...out])).not.toContain("private response");
    expect(calls).toBe(1);
  });
});

// Claude's structured-output schema subset excludes oneOf and numeric bounds.
// Exercise the real SDK serialization; only the HTTP service is simulated.
function restrictedProvider(answers: unknown[]) {
  const requests: unknown[] = [];
  function unsupported(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    return Object.entries(value).some(
      ([key, child]) => ["oneOf", "minimum", "maximum"].includes(key) || unsupported(child),
    );
  }
  const languageModel = createModel({
    provider: "openrouter",
    model: "fixture/model",
    apiKey: "test-only",
    fetchImpl: async (_url, init) => {
      const request: unknown = JSON.parse(String(init?.body));
      requests.push(request);
      if (unsupported(request))
        return Response.json(
          { error: { message: "Unsupported schema keyword", code: 400 } },
          { status: 400 },
        );
      return Response.json({
        id: "fixture",
        object: "chat.completion",
        created: 1,
        model: "fixture/model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: JSON.stringify({ answers }) },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
      });
    },
  });
  return { languageModel, requests };
}

describe("structured decision transport", () => {
  it("judges screenshot evidence using a provider-compatible schema", async () => {
    const provider = restrictedProvider([{ type: "predicate", name: "c1", probability: 0.9 }]);
    const screenshot =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
    const judgments = await judgeClaims(
      [
        {
          claim: { id: "c1", text: "The entered title survives reload.", kind: "browser" },
          result: {
            passed: true,
            completed: true,
            evidence: [{ type: "assertion", passed: true }],
            tester: "fixture",
            duration_ms: 1,
          },
          screenshotDataUrl: screenshot,
        },
      ],
      provider,
    );
    expect(judgments.get("c1")).toEqual({ verdict: "held", probability: 0.9 });
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]).toMatchObject({
      response_format: {
        type: "json_schema",
        json_schema: {
          schema: {
            properties: { answers: { items: { anyOf: expect.any(Array) } } },
          },
        },
      },
    });
    expect(JSON.stringify(provider.requests)).toContain(screenshot);
  });

  it("preserves predicate, choice, score and refusal answers", async () => {
    const answers = [
      { type: "predicate", name: "p", probability: 0 },
      { type: "choice", name: "c", choice: "browser", confidence: 1 },
      { type: "score", name: "s", score: 2, confidence: 0.5 },
      { type: "refusal", name: "r" },
    ];
    const provider = restrictedProvider(answers);
    await expect(
      decide(
        "fixture",
        [
          { type: "predicate", name: "p", instructions: "check" },
          {
            type: "choice",
            name: "c",
            instructions: "classify",
            choices: [{ value: "browser", description: "browser" }],
          },
          {
            type: "score",
            name: "s",
            instructions: "score",
            levels: [{ label: "2", description: "complete" }],
          },
          { type: "predicate", name: "r", instructions: "unknown" },
        ],
        provider,
      ),
    ).resolves.toEqual(answers);
    expect(provider.requests).toHaveLength(1);
  });

  it.each([-0.1, 1.1])(
    "still rejects probability and confidence outside 0..1: %s",
    async (value) => {
      for (const answer of [
        { type: "predicate", name: "c1", probability: value },
        { type: "choice", name: "c1", choice: "browser", confidence: value },
        { type: "score", name: "c1", score: 2, confidence: value },
      ]) {
        const provider = restrictedProvider([answer]);
        await expect(
          decide("fixture", [{ type: "predicate", name: "c1", instructions: "check" }], provider),
        ).rejects.toThrow("Decisions returned an invalid answer format");
        expect(provider.requests).toHaveLength(1);
      }
    },
  );
});

it("does not account rejected decisions input as a sent request", async () => {
  let sent = 0;
  const question = { type: "predicate", name: "duplicate", instructions: "test" } as const;
  await expect(
    decide("test", [question, question], {
      apiKey: "unused",
      onRequest: () => {
        sent++;
      },
    }),
  ).rejects.toThrow("unique");
  await expect(
    decide("test", [question], {
      onRequest: () => {
        sent++;
      },
    }),
  ).rejects.toThrow("OPENAI_API_KEY");
  expect(sent).toBe(0);
});
