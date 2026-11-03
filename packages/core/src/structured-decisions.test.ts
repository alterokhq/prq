import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { decide } from "./decisions.js";
import { judgeClaims } from "./judge.js";

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
