import { stripVTControlCharacters } from "node:util";
import type { Claim, ProofRequest } from "@prq/core";
import stringWidth from "string-width";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTerminalView } from "./terminal.js";

const claim: Claim = {
  id: "c1",
  text: "搜索中的家庭 👨‍👩‍👧‍👦 和 café remain visible after typing.",
  kind: "browser",
  verdict: "broken",
  observed: "The matching item disappeared after typing.",
  duration_ms: 1250,
  tester: "recorded tester",
  judge: "recorded judge",
};
function proof(claims: Claim[] = [claim]): ProofRequest {
  return {
    version: "0.1",
    id: "fixture",
    created_at: "2026-11-01T12:00:00Z",
    subject: { repo: "fixture", head: "abc1234" },
    source: {
      kind: "file",
      text: claims.map((row) => row.text).join("\n"),
      hash: `sha256:${"a".repeat(64)}`,
    },
    claims,
    summary: { held: 0, broken: claims.length, needs_human: 0, unverified: 0 },
    timing: { total_ms: 2500 },
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("terminal presentation", () => {
  it("distinguishes an inconclusive tester from an independent judgment without changing evidence", () => {
    const row: Claim = {
      ...claim,
      probability: 0,
      evidence: [{ type: "note", text: "ASSERTION_INCONCLUSIVE" }],
    };
    const source = proof([row]);
    const original = structuredClone(source);
    const writes: string[] = [];
    const view = createTerminalView({
      stream: { isTTY: true, columns: 80, rows: 100, write: (text) => writes.push(text) },
    });
    view.start({ subject: source.subject, claims: source.claims, hash: source.source.hash });
    view.finish(source, { reportPath: "report.html" });
    const output = stripVTControlCharacters(writes.join(""));
    expect(output).toContain("tester inconclusive · judge assessed recorded evidence");
    expect(output).toContain(row.observed);
    expect(source).toEqual(original);
  });

  it("shows only truthful preparation text and cleans it up on stop", () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const view = createTerminalView({
      stream: { isTTY: true, columns: 80, write: (text) => writes.push(text) },
    });
    view.prepare();
    vi.advanceTimersByTime(160);
    const output = stripVTControlCharacters(writes.join(""));
    expect(output).toContain("preparing checks");
    expect(output).not.toContain("locked");
    expect(output).not.toContain("claims");
    view.stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(writes.join("")).toContain("\r\u001b[2K");
  });
  it.each([40, 56, 80, 120])("keeps Unicode claims and metadata inside %i columns", (columns) => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const source = proof();
    const unchanged = structuredClone(source);
    const view = createTerminalView({
      stream: { isTTY: true, columns, rows: 100, write: (text) => writes.push(text) },
    });
    view.start({ subject: source.subject, claims: source.claims, hash: source.source.hash });
    view.progress("c1", "typing 搜索 👨‍👩‍👧‍👦");
    vi.advanceTimersByTime(1040);
    view.resolve(claim);
    view.finish(source, { reportPath: ".pr/runs/fixture/index.html" });
    const plain = stripVTControlCharacters(writes.join(""));
    for (const line of plain.split("\n")) expect(stringWidth(line)).toBeLessThanOrEqual(columns);
    expect(plain).toContain("👨‍👩‍👧‍👦");
    expect(plain).toContain("café");
    expect(plain).toContain("1 of 1 resolved");
    expect(plain).toContain("tester recorded tester");
    expect(plain).toContain("judge recorded judge");
    expect(source).toEqual(unchanged);
    const after = writes.length;
    vi.advanceTimersByTime(1000);
    expect(writes).toHaveLength(after);
  });

  it("switches tall frames to append-only output without cursor jumps or duplicate claims", () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const claims = Array.from({ length: 20 }, (_, index) => ({
      ...claim,
      id: `c${index}`,
      text: `Exact claim number ${index}.`,
    }));
    const source = proof(claims);
    const view = createTerminalView({
      stream: { isTTY: true, columns: 56, rows: 12, write: (text) => writes.push(text) },
    });
    view.start({ subject: source.subject, claims, hash: source.source.hash });
    for (const row of claims) view.resolve(row);
    view.finish(source, { reportPath: "report.html" });
    const output = writes.join("");
    // biome-ignore lint/suspicious/noControlCharactersInRegex: verify terminal cursor control is absent.
    expect(output).not.toMatch(/\u001b\[\d+A/);
    // Each claim appears once as its row and once as the recorded claimed detail.
    expect(stripVTControlCharacters(output).match(/Exact claim number 12\./g)).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([{ quiet: true }, { json: true }])("keeps agent mode silent: %j", (options) => {
    const writes: string[] = [];
    const source = proof();
    const view = createTerminalView({
      ...options,
      stream: { isTTY: true, columns: 80, write: (text) => writes.push(text) },
    });
    view.start({ subject: source.subject, claims: source.claims, hash: source.source.hash });
    view.prepare();
    view.progress("c1", "checking");
    view.resolve(claim);
    view.finish(source, { reportPath: "report.html" });
    view.stop();
    expect(writes).toEqual([]);
  });

  it("preserves plain redirected output without terminal controls", () => {
    const writes: string[] = [];
    const row: Claim = {
      id: "c1",
      text: "The helper is readable.",
      kind: "human",
      verdict: "needs_human",
    };
    const source = {
      ...proof([row]),
      summary: { held: 0, broken: 0, needs_human: 1, unverified: 0 },
    };
    const view = createTerminalView({
      stream: { isTTY: false, columns: 80, write: (text) => writes.push(text) },
    });
    view.start({ subject: source.subject, claims: source.claims, hash: source.source.hash });
    view.resolve(row);
    view.finish(source, { reportPath: "report.html" });
    expect(writes.join("")).toBe(
      "\n  prq  proof request  #aaaaaaa\n       fixture · abc1234\n       1 claims locked before checking\n\n  ? The helper is readable.\n    needs human\n\n  held 0 · broken 0 · needs a human 1\n  2.5s · locked #aaaaaaa\n\n  → report.html\n\n",
    );
  });

  it("respects NO_COLOR and strips control sequences from claims", () => {
    vi.stubEnv("NO_COLOR", "1");
    const writes: string[] = [];
    const source = proof([{ ...claim, text: "Before\u001b[2Jafter" }]);
    const view = createTerminalView({
      stream: { isTTY: true, columns: 80, rows: 100, write: (text) => writes.push(text) },
    });
    view.start({ subject: source.subject, claims: source.claims, hash: source.source.hash });
    view.finish(source, { reportPath: "report.html" });
    const output = writes.join("");
    expect(output).not.toContain("\u001b[2J");
    // biome-ignore lint/suspicious/noControlCharactersInRegex: verify ANSI color controls are absent.
    expect(output).not.toMatch(/\u001b\[(?:1|31|32|90)m/);
    expect(stripVTControlCharacters(output)).toContain("Beforeafter");
  });
});
