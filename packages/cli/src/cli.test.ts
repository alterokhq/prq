import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixPrompt, ProofRequest, summarize, tokenCount } from "@prq/core";
import { describe, expect, it } from "vitest";
import { agentJson, fullJson } from "./agent-output.js";
import { initProject } from "./init.js";
import { readProof, saveProof } from "./storage.js";

const fixture = ProofRequest.parse(
  JSON.parse(await readFile(new URL("../../../fixtures/example.json", import.meta.url), "utf8")),
);
describe("agent output", () => {
  it("exports every claim and evidence field in full JSON", () => {
    const source = structuredClone(fixture);
    const row = source.claims[0];
    if (!row) throw new Error("missing fixture row");
    source.claims = Array.from({ length: 100 }, (_, i) => ({
      ...row,
      id: `c${i}`,
      text: `Claim ${i}: ${"complete text ".repeat(50)}`,
      evidence: [{ type: "note", text: "Full observation" }],
    }));
    source.summary = summarize(source.claims);
    const output = JSON.parse(fullJson(source, "report.json"));
    expect(output.claims).toEqual(source.claims);
    expect(output.source).toEqual(source.source);
    expect(output.report).toBe("report.json");
    expect(output.omitted).toBeUndefined();
  });
  it("saves an inspectable JSON report without generated pages", async () => {
    const root = await mkdtemp(join(tmpdir(), "prq-json-storage-"));
    try {
      const path = await saveProof(root, fixture);
      expect(path).toBe(join(root, ".pr", "runs", fixture.id, "proof-request.json"));
      expect(await readProof(path)).toEqual(fixture);
      await expect(readFile(join(root, ".pr", "runs", fixture.id, "index.html"))).rejects.toThrow();
      await expect(readFile(join(root, ".pr", "runs", fixture.id, "card.html"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("keeps compact output bounded and full artifact unchanged", () => {
    const source = structuredClone(fixture);
    const row = fixture.claims.find((c) => c.verdict === "broken");
    if (!row) throw new Error("missing fixture row");
    source.claims = Array.from({ length: 100 }, (_, index) => ({
      ...row,
      id: `c${index}`,
      text: `本当に${"long ".repeat(30)}`,
    }));
    source.summary = summarize(source.claims);
    const output = agentJson(source, ".pr/runs/example/proof-request.json");
    expect(tokenCount(output)).toBeLessThan(300);
    expect(JSON.parse(output).omitted).toBeGreaterThan(0);
    expect(source.claims).toHaveLength(100);
  });
  it("keeps the complete simple broken claim in its bounded fix prompt", () => {
    const prompt = fixPrompt(fixture);
    expect(prompt).toContain("the search is case-insensitive");
    expect(prompt).toContain("prq rerun");
    expect(tokenCount(prompt)).toBeLessThan(300);
  });
});
describe("init", () => {
  it("creates the browser configuration used by the live demo", async () => {
    const root = await mkdtemp(join(tmpdir(), "prq-init-browser-"));
    try {
      const notes = await initProject(root, false);
      const config = await readFile(join(root, "e2e.config.ts"), "utf8");
      expect(config).toContain(
        "agents: { default: { model: openai('gpt-6.1-sol'), judgmentTimeout: 60000 } },",
      );
      expect(config).toContain("reporters: ['list', 'markdown']");
      expect(config).toContain("cache: { mode: 'read-write', dir: '.e2e/cache' }");
      expect(config).not.toContain("decisionExecutor");
      expect(notes.join("\n")).not.toContain("@e2e-dev/decision");
      await initProject(root, false);
      expect(await readFile(join(root, "e2e.config.ts"), "utf8")).toBe(config);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("preserves existing app configuration and hooks across repeated runs", async () => {
    const root = await mkdtemp(join(tmpdir(), "prq-init-"));
    try {
      await mkdir(join(root, ".codex"));
      await writeFile(join(root, "e2e.config.ts"), "existing config\n");
      await writeFile(join(root, "AGENTS.md"), "Existing instructions\n");
      await writeFile(
        join(root, ".codex", "hooks.json"),
        JSON.stringify({
          description: "keep",
          hooks: { Stop: [{ hooks: [{ type: "command", command: "existing" }] }] },
        }),
      );
      await initProject(root, true);
      await initProject(root, true);
      expect(await readFile(join(root, "e2e.config.ts"), "utf8")).toBe("existing config\n");
      expect((await readFile(join(root, "AGENTS.md"), "utf8")).match(/prq:start/g)).toHaveLength(1);
      const hooks = JSON.parse(await readFile(join(root, ".codex", "hooks.json"), "utf8"));
      expect(hooks.description).toBe("keep");
      expect(hooks.hooks.Stop).toHaveLength(2);
      expect(hooks.hooks.Stop[0].hooks[0].command).toBe("existing");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("useful compact output", () => {
  it("retains the ordinary broken claim and full artifact path", () => {
    const report = ".pr/runs/1234567-example-12345678/proof-request.json";
    const parsed = JSON.parse(agentJson(fixture, report));
    expect(parsed.broken[0].claimed).toBe("the search is case-insensitive");
    expect(parsed.broken[0].observed).toContain("DARK");
    expect(parsed.report).toBe(report);
    expect(parsed.omitted).toBe(0);
  });
});
