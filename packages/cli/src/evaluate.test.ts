import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
function run(root: string, args: string[]) {
  return spawnSync(process.execPath, [cli, "eval", ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 10000,
    env: { PATH: process.env.PATH },
  });
}
it("evaluates offline outside Git, preserves JSON artifacts and requires explicit live credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "prq-eval-"));
  try {
    const output = join(root, "result.json");
    const first = run(root, ["--json", "--out", output]);
    expect(first.status, first.stderr).toBe(0);
    const report = JSON.parse(first.stdout);
    expect(report).toMatchObject({
      format: "prq-eval/v1",
      mode: "deterministic",
      summary: { total: 9, matched: 9, false_passes: 0, false_alarms: 0, cost_usd: 0 },
    });
    expect(report.tool.executable_sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(report.configuration).toBeUndefined();
    const saved = await readFile(output, "utf8");
    expect(JSON.parse(saved)).toEqual(report);
    expect(run(root, ["--json", "--out", output]).status).toBe(2);
    expect(await readFile(output, "utf8")).toBe(saved);
    const invalid = run(root, ["--case", "typo", "--json"]);
    expect(invalid.status).toBe(2);
    expect(invalid.stdout).toContain("Choose case IDs");
    const live = run(root, ["--live", "--case", "known-good", "--json"]);
    expect(live.status).toBe(2);
    expect(live.stdout).toContain("OPENAI_API_KEY");
    const terminal = run(root, ["--case", "zero-tests,provider-budget"]);
    expect(terminal.status).toBe(0);
    expect(terminal.stdout).toContain("2/2 matched");
    expect(terminal.stdout).toContain("fault_injection");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
