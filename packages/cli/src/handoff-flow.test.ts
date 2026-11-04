import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProofRequest } from "@prq/core";
import { expect, it } from "vitest";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const handoff = {
  format: "prq-claims/v1",
  // Taskless compatibility path; task-bearing runs are exercised with intercepted providers.
  task: undefined,
  source: "The help text is readable.",
  unfinished: [],
  claims: [{ id: "help", text: "The help text is readable.", kind: "human" }],
};
function git(root: string, args: string[]) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
function commit(root: string) {
  git(root, ["add", "."]);
  git(root, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "--allow-empty",
    "-qm",
    "Fixture",
  ]);
}
function run(cwd: string, args: string[], key = false) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 15000,
    env: { PATH: process.env.PATH, ...(key ? { OPENAI_API_KEY: "fixture-only-unused" } : {}) },
  });
}

it("hands explicit claims through a nested CLI run, signoff, gate and a targeted rerun", async () => {
  const root = await mkdtemp(join(tmpdir(), "prq-handoff-flow-"));
  try {
    const project = join(root, "service");
    await mkdir(project);
    await mkdir(join(root, ".pr"));
    await writeFile(join(root, ".gitignore"), ".pr/\n");
    await writeFile(join(project, "README.md"), "Fixture\n");
    git(root, ["init", "-q"]);
    commit(root);
    const input = join(root, ".pr", "claims.json");
    await writeFile(input, JSON.stringify(handoff));
    const initial = run(project, ["--claims-json", input, "--strict", "--json"], true);
    expect(initial.stderr).toBe("");
    expect(initial.status).toBe(2);
    const output = JSON.parse(initial.stdout);
    const pr = ProofRequest.parse(output);
    expect(pr.subject.project).toBe("service");
    expect(pr.handoff).toEqual({ format: handoff.format, task: handoff.task, unfinished: [] });
    expect(pr.claims[0]).toMatchObject(handoff.claims[0] ?? {});
    expect(pr.model_usage).toEqual([]);
    expect(isAbsolute(output.report)).toBe(true);
    expect(await realpath(output.report)).toBe(
      await realpath(join(root, ".pr", "runs", pr.id, "proof-request.json")),
    );
    expect(run(root, ["gate", output.report, "--claims-json", input, "--json"]).status).toBe(2);

    // The gate requires no credentials and leaves named exceptions visible.
    expect(
      run(root, ["signoff", "help", "--run", output.report, "--by", "Reviewer", "--accept"]).status,
    ).toBe(0);
    const accepted = run(root, ["gate", output.report, "--claims-json", input, "--json"]);
    expect(accepted.status).toBe(0);
    expect(JSON.parse(accepted.stdout)).toMatchObject({ format: "prq-gate/v1", ready: true });
    const signed = ProofRequest.parse(JSON.parse(await readFile(output.report, "utf8")));
    expect(signed.claims[0]?.verdict).toBe("needs_human");
    expect(signed.claims[0]?.signoff?.by).toBe("Reviewer");

    await writeFile(join(project, "README.md"), "Dirty change\n");
    const dirty = run(root, ["gate", output.report, "--claims-json", input, "--json"]);
    expect(dirty.status).toBe(2);
    expect(dirty.stdout).toContain("working tree has changes");
    commit(root);
    const stale = run(root, ["gate", output.report, "--claims-json", input, "--json"]);
    expect(stale.status).toBe(2);
    expect(stale.stdout).toContain("different commit");

    // An unrelated latest report must not replace an explicitly selected run.
    await writeFile(join(root, ".pr", "last.json"), "{}");
    const next = run(root, ["rerun", "--run", output.report, "--strict", "--json"], true);
    expect(next.status).toBe(2);
    const nextOutput = JSON.parse(next.stdout);
    const rerun = ProofRequest.parse(nextOutput);
    expect(rerun.id).not.toBe(pr.id);
    expect(rerun.subject.project).toBe("service");
    expect(rerun.subject.head).not.toBe(pr.subject.head);
    expect(rerun.source).toEqual(pr.source);
    expect(rerun.handoff).toEqual(pr.handoff);
    expect(rerun.claims[0]?.signoff).toBeNull();
    expect(
      run(root, ["rerun", "--run", output.report, "--project", ".", "--json"], true).status,
    ).toBe(2);
    expect(
      run(root, ["signoff", "help", "--run", nextOutput.report, "--by", "Reviewer", "--reject"])
        .status,
    ).toBe(0);
    expect(run(root, ["gate", nextOutput.report, "--claims-json", input, "--json"]).status).toBe(1);

    await writeFile(input, JSON.stringify({ ...handoff, task: "Another task" }));
    const mismatched = run(root, ["gate", nextOutput.report, "--claims-json", input, "--json"]);
    expect(mismatched.stdout).toContain("does not match this explicit builder handoff");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

it("rejects implicit strict input and malformed handoffs before requesting a model", async () => {
  const root = await mkdtemp(join(tmpdir(), "prq-handoff-invalid-"));
  try {
    git(root, ["init", "-q"]);
    commit(root);
    const implicit = run(root, ["--strict", "--from-stdin", "--json"]);
    expect(implicit.status).toBe(2);
    expect(implicit.stdout).toContain("explicit --claims-json handoff");
    const input = join(root, "claims.json");
    await writeFile(input, JSON.stringify({ ...handoff, claims: [] }));
    const invalid = run(root, ["--claims-json", input, "--json"]);
    expect(invalid.status).toBe(2);
    expect(invalid.stdout).toContain("prq-error/v1");
    expect(invalid.stdout).not.toContain("OPENAI_API_KEY");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("does not execute a builder command outside the selected project's allowlist", async () => {
  const root = await mkdtemp(join(tmpdir(), "prq-handoff-command-"));
  try {
    git(root, ["init", "-q"]);
    await mkdir(join(root, "service"));
    await writeFile(
      join(root, "service", "prq.config.json"),
      JSON.stringify({ commands: ["node --version"] }),
    );
    commit(root);
    const input = join(root, "claims.json");
    await writeFile(
      input,
      JSON.stringify({
        ...handoff,
        claims: [
          {
            ...handoff.claims[0],
            kind: "command",
            check: { command: "echo bypass > unexpected.txt" },
          },
        ],
      }),
    );
    const result = run(
      root,
      ["--project", "service", "--claims-json", input, "--strict", "--json"],
      true,
    );
    expect(result.status).toBe(2);
    const report = ProofRequest.parse(JSON.parse(result.stdout));
    expect(report.subject.project).toBe("service");
    expect(report.claims[0]?.verdict).toBe("unverified");
    expect(report.claims[0]?.observed).toContain("No allowed verification command");
    expect(report.model_usage).toEqual([]);
    await expect(readFile(join(root, "service", "unexpected.txt"))).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each([
  [[], 2, "unverified"],
  [[{ name: "real assertion", status: "failed", attempts: 1 }], 1, "broken"],
] as const)(
  "carries structured test outcomes into the CLI gate: %j",
  async (tests, exit, verdict) => {
    const root = await mkdtemp(join(tmpdir(), "prq-structured-flow-"));
    try {
      git(root, ["init", "-q"]);
      await writeFile(join(root, ".gitignore"), ".pr/\n");
      await writeFile(
        join(root, "prq.config.json"),
        JSON.stringify({ commands: [{ command: "node check.cjs", report: "results/test.json" }] }),
      );
      await writeFile(
        join(root, "check.cjs"),
        `const fs = require('node:fs'); fs.writeFileSync(process.env.PRQ_TEST_REPORT, JSON.stringify({ format: 'prq-test-results/v1', framework: 'fixture', run_token: process.env.PRQ_RUN_TOKEN, complete: true, errors: 0, tests: ${JSON.stringify(tests)} }));`,
      );
      commit(root);
      await mkdir(join(root, ".pr"));
      const input = join(root, ".pr/claims.json");
      await writeFile(
        input,
        JSON.stringify({
          ...handoff,
          source: "All tests pass.",
          claims: [
            {
              id: "suite",
              text: "All tests pass.",
              kind: "command",
              check: { command: "node check.cjs" },
            },
          ],
        }),
      );
      const execution = run(root, ["--claims-json", input, "--strict", "--json"], true);
      expect(execution.status, execution.stderr).toBe(exit);
      const output = JSON.parse(execution.stdout);
      expect(output.claims[0].verdict).toBe(verdict);
      expect(
        output.claims[0].evidence.find((e: { type: string }) => e.type === "command").test_summary
          .total,
      ).toBe(tests.length);
      expect(output.model_usage).toEqual([]);
      expect(run(root, ["gate", output.report, "--claims-json", input, "--json"]).status).toBe(
        exit,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  15000,
);
