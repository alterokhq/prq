import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { ProofRequest } from "@prq/core";
import { describe, expect, it } from "vitest";
import { renderCard, renderMarkdown, renderPage } from "./index.js";
import { script } from "./script.js";

function fixture() {
  return ProofRequest.parse(
    JSON.parse(readFileSync(new URL("../../../fixtures/example.json", import.meta.url), "utf8")),
  );
}

describe("static proof reports", () => {
  it("keeps hostile source, evidence and claim text inert while preserving the downloadable JSON", () => {
    const pr = fixture();
    const hostile = '</script><img src="https://invalid.example/a" onerror="alert(1)">';
    pr.source.text = hostile;
    pr.subject.title = hostile;
    const claim = pr.claims[0];
    if (!claim) throw new Error("fixture must contain a claim");
    claim.text = hostile;
    claim.observed = hostile;
    claim.evidence = [{ type: "console", text: hostile }];
    const html = renderPage(pr);
    expect(html).not.toContain(hostile);
    expect(html).toContain("&lt;/script&gt;&lt;img");
    const data = html.match(/id="proof-data">([\s\S]*?)<\/script>/)?.[1];
    expect(data).toBeDefined();
    expect(JSON.parse(data ?? "null")).toEqual(pr);
    expect(html.match(/<script/g)).toHaveLength(2);
  });

  it("only embeds local evidence paths and keeps replay wording accurate", () => {
    const pr = fixture();
    const claim = pr.claims[0];
    if (!claim) throw new Error("fixture must contain a claim");
    claim.cached = true;
    claim.evidence = [
      { type: "screenshot", path: "https://invalid.example/track.png" },
      { type: "screenshot", path: "../private.png" },
      { type: "screenshot", path: "evidence/c1/screen 1.png" },
    ];
    const html = renderPage(pr);
    expect(html).not.toContain('src="https://');
    expect(html).not.toContain('src="../');
    expect(html).toContain('src="evidence/c1/screen%201.png"');
    expect(html).toContain("setup replayed · assertions checked live");
    expect(html).not.toContain("fonts.googleapis.com");
  });

  it("renders every claim, machine evidence and independent judge data", () => {
    const pr = fixture();
    const html = renderPage(pr);
    expect(html.match(/class="claim-row /g)).toHaveLength(pr.claims.length);
    expect(html).toContain("probability the claim holds");
    expect(html).toContain("Prepare signoff command");
    expect(html).toContain("Download JSON");
    expect(renderCard(pr)).toContain('class="share-card"');
    expect(renderCard(pr)).toContain("broken 1");
    expect(renderMarkdown(pr)).toContain("needs a human 1");
  });

  it("preserves the purpose of HTTP evidence rather than presenting availability as a claim check", () => {
    const pr = fixture();
    const claim = pr.claims[0];
    if (!claim) throw new Error("fixture must contain a claim");
    claim.evidence = [
      {
        type: "http",
        method: "GET",
        url: "http://localhost:3000",
        status: 200,
        text: "Availability probe only; not evidence of this claim.",
      },
    ];
    expect(renderPage(pr)).toContain("Availability probe only; not evidence of this claim.");
  });

  it("ships syntactically valid local interactions", () => {
    expect(() => new Script(script)).not.toThrow();
  });

  it("labels recorded stages and shows the last broken-claim screen on the card", () => {
    const pr = fixture();
    const claim = pr.claims.find((row) => row.verdict === "broken");
    if (!claim) throw new Error("fixture must contain a broken claim");
    claim.observed = "The tester could not establish the comparison.";
    claim.evidence = [
      { type: "note", text: "agent.assert: limited comparison [ASSERTION_INCONCLUSIVE]" },
      { type: "screenshot", path: "evidence/001-before-setup.png" },
      { type: "screenshot", path: "evidence/002-assert.png" },
      { type: "screenshot", path: "evidence/003-failure.png" },
    ];
    const page = renderPage(pr);
    expect(page).toContain("before setup");
    expect(page).toContain("assertion screen");
    expect(page).toContain("The tester marked its assertion inconclusive.");
    expect(page).toContain("The independent judge assessed the recorded evidence");
    expect(page).toContain(claim.observed);
    const card = renderCard(pr);
    expect(card).toContain('src="evidence/003-failure.png"');
    expect(card).not.toContain('src="evidence/001-before-setup.png"');
  });
});
