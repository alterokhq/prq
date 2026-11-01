import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DraftClaim } from "@prq/core";
import { afterEach, describe, expect, it } from "vitest";
import { generateTestFile } from "./index.js";
import { collectReport, E2eReport } from "./report.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "prq-report-test-"));
  roots.push(root);
  const input: unknown = JSON.parse(
    await readFile(new URL("../../../fixtures/e2e-report.sample.json", import.meta.url), "utf8"),
  );
  const report = E2eReport.parse(input);
  const claims: DraftClaim[] = report.run.results.map((_result, index) => ({
    id: `c${index + 1}`,
    text: `Claim ${index + 1}`,
    kind: "browser",
  }));
  for (const [index, result] of report.run.results.entries()) {
    const claim = claims[index];
    if (!claim) throw new Error("Missing test fixture claim");
    result.titlePath = [`${claim.id}: ${claim.text}`];
    for (const attempt of result.attempts) {
      for (const step of attempt.steps) if (step.api === "agent.assert") step.label = claim.text;
      for (const artifact of attempt.artifacts) {
        if (!artifact.path) continue;
        const path = join(root, "report", "results", artifact.path);
        await mkdir(join(path, ".."), { recursive: true });
        await writeFile(
          path,
          artifact.kind === "screenshot" ? "test screenshot bytes" : "test log",
        );
      }
    }
  }
  return {
    report,
    claims,
    reportDir: join(root, "report"),
    runDir: join(root, "run"),
    testFile: "tests/prq-smoke.e2e.ts",
  };
}

describe("browser evidence", () => {
  it("collects matching completed assertions and copies real report artifacts", async () => {
    const input = await fixture();
    const results = await collectReport(input);
    expect(results.get("c1")?.passed).toBe(true);
    expect(results.get("c2")?.passed).toBe(false);
    const screenshot = results.get("c1")?.evidence.find((item) => item.type === "screenshot");
    expect(screenshot?.path).toBeTruthy();
    expect(await readFile(join(input.runDir, screenshot?.path ?? ""), "utf8")).toBe(
      "test screenshot bytes",
    );
  });

  it("keeps provider outages unverified even when e2e calls the test failed", async () => {
    const input = await fixture();
    const attempt = input.report.run.results[1]?.attempts[0];
    if (!attempt) throw new Error("Missing test attempt");
    for (const step of attempt.steps)
      if (step.api === "agent.assert")
        step.error = { code: "MODEL_PROVIDER_FAILED", message: "Provider unavailable" };
    const results = await collectReport(input);
    expect(results.get("c2")?.passed).toBeUndefined();
    expect(results.get("c2")?.completed).not.toBe(true);
  });

  it("distinguishes completed inconclusive assertions from unavailable execution", async () => {
    const input = await fixture();
    const attempt = input.report.run.results[1]?.attempts[0];
    if (!attempt) throw new Error("Missing test attempt");
    for (const step of attempt.steps)
      if (step.api === "agent.assert")
        step.error = {
          code: "ASSERTION_INCONCLUSIVE",
          message: "Current screen cannot establish comparison",
        };
    const results = await collectReport(input);
    expect(results.get("c2")?.passed).toBeUndefined();
    expect(results.get("c2")?.completed).toBe(true);
    expect(
      results.get("c2")?.steps?.some((step) => step.observation?.includes("Custom fields")),
    ).toBe(true);
  });

  it("does not accept reports for another file or differently worded assertion", async () => {
    const input = await fixture();
    const first = input.report.run.results[0];
    if (!first) throw new Error("Missing test result");
    first.file = "tests/stale.e2e.ts";
    const results = await collectReport(input);
    expect(results.get("c1")?.passed).toBeUndefined();
  });

  it("maps out-of-order parallel results by exact claim file without mixing evidence", async () => {
    const input = await fixture();
    const files = new Map([
      ["c1", "tests/prq-c1.e2e.ts"],
      ["c2", "tests/prq-c2.e2e.ts"],
    ]);
    for (const [index, result] of input.report.run.results.entries()) {
      result.file = `tests/prq-c${index + 1}.e2e.ts`;
      for (const attempt of result.attempts) {
        attempt.appLog = [{ source: "console", level: "info", text: `only-c${index + 1}` }];
      }
    }
    const unrelated = structuredClone(input.report.run.results[0]);
    if (!unrelated) throw new Error("Missing result");
    unrelated.file = "tests/unrelated.e2e.ts";
    input.report.run.results.push(unrelated);
    input.report.run.results.reverse();
    const results = await collectReport({ ...input, testFiles: files });
    expect(results.get("c1")?.passed).toBe(true);
    expect(results.get("c2")?.passed).toBe(false);
    expect(
      results
        .get("c1")
        ?.evidence.filter((e) => e.type === "console")
        .map((e) => e.text),
    ).toEqual(["only-c1"]);
    expect(
      results
        .get("c2")
        ?.evidence.filter((e) => e.type === "console")
        .map((e) => e.text),
    ).toEqual(["only-c2"]);
    const missing = await collectReport({
      ...input,
      testFiles: new Map([["c1", "tests/prq-c1.e2e.ts"]]),
    });
    expect(missing.get("c2")?.passed).toBeUndefined();
    expect(missing.get("c2")?.evidence.some((e) => e.type === "screenshot")).toBe(false);
  });

  it("records setup replay while requiring a live assertion", async () => {
    const input = await fixture();
    const attempt = input.report.run.results[0]?.attempts[0];
    if (!attempt) throw new Error("Missing test attempt");
    attempt.steps.unshift({
      api: "agent.act",
      label: "Enter query",
      status: "passed",
      index: 0,
      cache: { mode: "self-finalized", replayedActions: 1 },
    });
    const results = await collectReport(input);
    expect(results.get("c1")?.cached).toBe(true);
    expect(results.get("c1")?.passed).toBe(true);
  });

  it("generates escaped assertions without changing claim text", () => {
    const claim: DraftClaim = {
      id: "c1",
      text: 'Exact CASE and "quotes".\nSecond line.',
      kind: "browser",
      check: { setup: "type a query" },
    };
    const generated = generateTestFile([claim]);
    expect(generated).toContain(
      `await agent.assert(${JSON.stringify(claim.text)}, { vision: true });`,
    );
    expect(generated).toContain('await agent.act("type a query This is setup only:');
  });
});
