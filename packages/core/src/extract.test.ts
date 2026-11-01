import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { ClaimExtractionIssue, extractClaims } from "./extract.js";

function extraction(text: string) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({ claims: [{ id: "c1", text, kind: "browser", check: null }] }),
        },
      ],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 10, text: 10, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}
describe("verbatim extraction", () => {
  it("rejects an opposite claim that is absent from the source", async () => {
    await expect(
      extractClaims("Search is case-insensitive.", {
        model: extraction("Search is case-sensitive."),
      }),
    ).rejects.toBeInstanceOf(ClaimExtractionIssue);
  });
  it.each([
    "search is case-insensitive.",
    "Search is case insensitive.",
    "Search is case-insensitive!",
  ])("rejects normalized or rewritten wording: %s", async (text) => {
    await expect(
      extractClaims("Search is case-insensitive.", { model: extraction(text) }),
    ).rejects.toThrow("verbatim");
  });
  it("returns an exact source sentence unchanged", async () => {
    const text = "Search is case-insensitive.";
    const claims = await extractClaims(`Added a search input. ${text}`, {
      model: extraction(text),
    });
    expect(claims[0]?.text).toBe(text);
  });
  it("accepts an exact self-contained clause without changing punctuation", async () => {
    const text = "search finds exact titles";
    const claims = await extractClaims(`The input is visible; ${text}.`, {
      model: extraction(text),
    });
    expect(claims[0]?.text).toBe(text);
  });
});
