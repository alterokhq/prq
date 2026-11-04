import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ClaimsHandoff, verificationExitCode } from "./handoff.js";
import { ProofRequest } from "./schema.js";

const fixture = ProofRequest.parse(
  JSON.parse(await readFile(new URL("../../../fixtures/example.json", import.meta.url), "utf8")),
);
const input = {
  format: "prq-claims/v1",
  source: "Search ignores case.",
  claims: [
    { id: "search", text: "Search ignores case.", kind: "command", check: { command: "pytest" } },
  ],
};

describe("builder handoff", () => {
  it("preserves the builder's exact claims and defaults unfinished work to empty", () => {
    expect(ClaimsHandoff.parse(input)).toEqual({ ...input, unfinished: [] });
  });
  it.each([
    { ...input, claims: [] },
    { ...input, claims: [...input.claims, ...input.claims] },
    { ...input, source: "Different promise" },
    { ...input, claims: [{ ...input.claims[0], verdict: "held" }] },
  ])("rejects missing, duplicate, rewritten or pre-judged claims", (value) => {
    expect(ClaimsHandoff.safeParse(value).success).toBe(false);
  });
});

describe("strict completion", () => {
  it("requires a named acceptance for human rows and still reports the exception", () => {
    const pr = structuredClone(fixture);
    pr.claims = [{ id: "human", text: "Readable", kind: "human", verdict: "needs_human" }];
    const row = pr.claims[0];
    if (!row) throw new Error("missing row");
    expect(verificationExitCode(pr)).toBe(0);
    expect(verificationExitCode(pr, true)).toBe(2);
    row.signoff = { by: "Reviewer", decision: "accepted", at: new Date().toISOString() };
    expect(verificationExitCode(pr, true)).toBe(0);
    expect(row.verdict).toBe("needs_human");
    row.signoff.by = " ";
    expect(verificationExitCode(pr, true)).toBe(2);
    row.signoff.decision = "rejected";
    expect(verificationExitCode(pr, true)).toBe(1);
  });
  it("blocks unfinished and empty runs and trusts rows instead of summary counts", () => {
    const pr = structuredClone(fixture);
    pr.claims = [{ id: "check", text: "Works", kind: "command", verdict: "held" }];
    expect(verificationExitCode(pr, true)).toBe(0);
    pr.handoff = { format: "prq-claims/v1", unfinished: ["Missing edge case"] };
    expect(verificationExitCode(pr, true)).toBe(2);
    pr.handoff.unfinished = [];
    pr.claims = [];
    expect(verificationExitCode(pr, true)).toBe(2);
    pr.claims = [{ id: "check", text: "Works", kind: "command", verdict: "unverified" }];
    expect(verificationExitCode(pr, true)).toBe(2);
    pr.claims[0] = { id: "check", text: "Works", kind: "command", verdict: "broken" };
    expect(verificationExitCode(pr, true)).toBe(1);
  });
});
