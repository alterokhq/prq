import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { afterEach, expect, it, vi } from "vitest";

const models = vi.hoisted((): { count: number; outputs: unknown[] } => ({ count: 0, outputs: [] }));
vi.mock("@prq/core", async (original) => {
  const core = await original<typeof import("@prq/core")>();
  return {
    ...core,
    createModel: () =>
      core.evaluationFixtureModel(
        models.count++ % 2 === 0
          ? models.outputs
          : [{ answers: [{ name: "c1", type: "predicate", probability: 1 }] }],
      ),
  };
});

import { checkHandoff } from "./gate.js";
import { runProof } from "./workflow.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  models.count = 0;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function commit(root: string) {
  await execa("git", ["add", "."], { cwd: root });
  await execa(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "Fixture",
    ],
    { cwd: root },
  );
}
async function setup() {
  vi.stubEnv("OPENAI_API_KEY", "fixture-only-unused");
  const root = await mkdtemp(join(tmpdir(), "prq-coverage-flow-"));
  roots.push(root);
  await execa("git", ["init", "-q", root]);
  await writeFile(join(root, ".gitignore"), ".pr/\n");
  await writeFile(join(root, "check.cjs"), 'console.log("check executed");');
  await writeFile(join(root, "prq.config.json"), JSON.stringify({ commands: ["node check.cjs"] }));
  await commit(root);
  await mkdir(join(root, ".pr"));
  const claimsJson = join(root, ".pr/claims.json");
  await writeFile(
    claimsJson,
    JSON.stringify({
      format: "prq-claims/v1",
      task: "Run the check.",
      source: "The command exits 0.",
      unfinished: [],
      claims: [
        {
          id: "c1",
          text: "The command exits 0.",
          kind: "human",
          check: { command: "echo builder-recipe > forbidden.txt" },
        },
      ],
    }),
  );
  models.outputs = [
    { requirements: ["Run the check."] },
    {
      requirements: [
        {
          requirement_id: "r1",
          status: "covered",
          claim_ids: ["c1"],
          reason: "Explicit completion promise",
        },
      ],
      checks: [
        {
          claim_id: "c1",
          kind: "command",
          check: { path: null, setup: null, command: "node check.cjs" },
          reason: "Run the allowed check",
        },
      ],
    },
  ];
  return { root, claimsJson };
}
const options = {
  project: ".",
  quiet: true,
  provider: "openai",
  model: "fixture",
  decisionMode: "structured",
  timeout: 5000,
};
it("chooses and runs independent checks, gates coverage, and freshly assesses a targeted rerun", async () => {
  const { root, claimsJson } = await setup();
  const first = await runProof(root, { ...options, claimsJson });
  expect(first.pr.claims[0]).toMatchObject({
    id: "c1",
    kind: "command",
    check: { command: "node check.cjs" },
    verdict: "held",
  });
  expect(first.pr.model_usage?.map((row) => row.stage)).toEqual([
    "requirements",
    "coverage",
    "judge",
  ]);
  expect(first.pr.coverage?.status).toBe("assessed");
  expect((await checkHandoff(root, first.pr, claimsJson)).ready).toBe(true);
  await expect(readFile(join(root, "forbidden.txt"))).rejects.toThrow();
  await writeFile(join(root, "check.cjs"), "process.exit(1);");
  await commit(root);
  const rerun = await runProof(root, options, first.pr);
  expect(rerun.pr.id).not.toBe(first.pr.id);
  expect(rerun.pr.source).toEqual(first.pr.source);
  expect(rerun.pr.coverage).toEqual(first.pr.coverage);
  expect(rerun.pr.model_usage?.map((row) => row.stage)).toEqual([
    "requirements",
    "coverage",
    "judge",
  ]);
  expect(rerun.pr.claims[0]?.verdict).toBe("broken");
  expect((await checkHandoff(root, rerun.pr, claimsJson)).exitCode).toBe(1);
  expect(JSON.parse(await readFile(first.reportPath, "utf8")).claims[0].verdict).toBe("held");
}, 15000);
it("saves a recoverable report without running the builder's recipe when assessment fails", async () => {
  const { root, claimsJson } = await setup();
  models.outputs = [];
  const { pr, reportPath } = await runProof(root, { ...options, claimsJson });
  expect(pr.coverage?.status).toBe("unavailable");
  expect(pr.claims[0]?.verdict).toBe("unverified");
  expect(pr.model_usage).toHaveLength(1);
  expect(pr.model_usage?.[0]).toMatchObject({
    stage: "requirements",
    status: "unavailable",
    cost_usd: null,
  });
  expect((await checkHandoff(root, pr, claimsJson)).exitCode).toBe(2);
  expect(JSON.parse(await readFile(reportPath, "utf8")).coverage.status).toBe("unavailable");
  expect(JSON.stringify(pr)).not.toContain("fixture-only-unused");
}, 15000);

it("blocks strict handoff for an omitted requirement even when every submitted claim holds", async () => {
  const { root, claimsJson } = await setup();
  const handoff = JSON.parse(await readFile(claimsJson, "utf8"));
  handoff.task = "Run the check. Handle empty input.";
  await writeFile(claimsJson, JSON.stringify(handoff));
  models.outputs = [
    { requirements: ["Run the check.", "Handle empty input."] },
    {
      requirements: [
        { requirement_id: "r1", status: "covered", claim_ids: ["c1"], reason: "Explicit promise" },
        {
          requirement_id: "r2",
          status: "missing",
          claim_ids: [],
          reason: "No empty input promise",
        },
      ],
      checks: [
        {
          claim_id: "c1",
          kind: "command",
          check: { path: null, setup: null, command: "node check.cjs" },
          reason: "Run the allowed check",
        },
      ],
    },
  ];
  const { pr } = await runProof(root, { ...options, claimsJson });
  expect(pr.summary.held).toBe(1);
  const gate = await checkHandoff(root, pr, claimsJson);
  expect(gate.ready).toBe(false);
  expect(gate.exitCode).toBe(2);
  expect(JSON.stringify(gate)).toContain("Handle empty input.");
}, 15000);
