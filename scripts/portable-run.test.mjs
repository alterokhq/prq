import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { lockClaims } from "../packages/core/dist/index.js";
import { portableRun } from "./portable-run.mjs";

test("real CLI reruns keep the lock and report local/CI source without carrying old results forward", {
  timeout: 30_000,
}, async () => {
  const cwd = await mkdtemp(join(tmpdir(), "prq-portable-"));
  const cli = fileURLToPath(new URL("../packages/cli/dist/index.js", import.meta.url));
  const git = (args) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    git(["init"]);
    await writeFile(join(cwd, "source.txt"), "baseline");
    git(["add", "source.txt"]);
    git([
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "-m",
      "Baseline",
    ]);
    const head = git(["rev-parse", "HEAD"]);
    const claims = [
      { id: "human", text: "The wording is clear.", kind: "human", verdict: "needs_human" },
    ];
    const original = {
      version: "0.2",
      id: "before",
      created_at: new Date().toISOString(),
      subject: { head },
      source: { kind: "file", text: claims[0].text, hash: lockClaims(claims) },
      claims,
      summary: { held: 0, broken: 0, needs_human: 1, unverified: 0 },
    };
    const report = join(cwd, "original.json");
    await writeFile(report, JSON.stringify(original));
    const env = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      OPENAI_API_KEY: "fixture-only-unused",
    };
    const local = await portableRun({ cli, cwd, report, expectedHead: head, env });
    const ci = await portableRun({
      cli,
      cwd,
      report,
      expectedHead: head,
      env,
      location: "ci",
      executor: "github_actions",
    });
    assert.equal(local.exit_code, 2);
    assert.equal(ci.exit_code, 2);
    const a = JSON.parse(await readFile(local.report, "utf8"));
    const b = JSON.parse(await readFile(ci.report, "utf8"));
    assert.notEqual(a.id, b.id);
    assert.equal(a.source.hash, original.source.hash);
    assert.equal(b.source.hash, original.source.hash);
    assert.equal(b.subject.head, head);
    assert.deepEqual(b.execution, {
      location: "ci",
      executor: "github_actions",
      application_revision: "unknown",
    });
    assert.equal(a.execution.location, "local");
    assert.equal(a.claims[0].verdict, "needs_human");
    const action = fileURLToPath(new URL("./github-action.mjs", import.meta.url));
    const event = join(cwd, "event.json");
    const outputs = join(cwd, "outputs.txt");
    await writeFile(event, JSON.stringify({ pull_request: { head: { sha: head } } }));
    const actionEnv = {
      ...env,
      INPUT_CLI: cli,
      INPUT_REPORT: report,
      INPUT_HEAD: head,
      GITHUB_WORKSPACE: cwd,
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_EVENT_PATH: event,
      GITHUB_OUTPUT: outputs,
    };
    const actionResult = spawnSync(process.execPath, [action], {
      cwd,
      env: actionEnv,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(actionResult.status, 2);
    assert.equal(JSON.parse(actionResult.stdout).execution.head, head);
    assert.match(await readFile(outputs, "utf8"), /exit-code=2/);
    const wrongEvent = spawnSync(process.execPath, [action], {
      cwd,
      env: { ...actionEnv, INPUT_HEAD: "b".repeat(40) },
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(wrongEvent.status, 2);
    assert.match(wrongEvent.stderr, /pull request's head/);
    const missing = await portableRun({
      cli,
      cwd,
      report,
      expectedHead: head,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
    });
    assert.equal(missing.exit_code, 2);
    assert.equal(missing.report, null);
    assert.deepEqual(JSON.parse(await readFile(local.report, "utf8")), a);
    // Real runner, SDK and writer; only HTTP is replaced. No account is charged.
    await writeFile(join(cwd, "lint.cjs"), "console.log('completed lint evidence');\n");
    await writeFile(join(cwd, "prq.config.json"), JSON.stringify({ commands: ["node lint.cjs"] }));
    git(["add", "lint.cjs", "prq.config.json"]);
    git([
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "-m",
      "Add lint control",
    ]);
    const budgetHead = git(["rev-parse", "HEAD"]);
    const budgetClaims = [
      {
        id: "lint",
        text: "The command exits with code 0.",
        kind: "command",
        check: { command: "node lint.cjs" },
        verdict: "unverified",
      },
    ];
    const budgetReport = join(cwd, "budget.json");
    await writeFile(
      budgetReport,
      JSON.stringify({
        ...original,
        source: { ...original.source, hash: lockClaims(budgetClaims) },
        claims: budgetClaims,
      }),
    );
    const bootstrap = join(cwd, "budget-bootstrap.mjs");
    const requested = join(cwd, "provider-requested.txt");
    await writeFile(
      bootstrap,
      `import {writeFileSync} from 'node:fs';
globalThis.fetch = async () => { writeFileSync(${JSON.stringify(requested)}, 'HTTP 402 injected'); return new Response(JSON.stringify({error:{message:'budget exhausted',code:402}}), {status:402,headers:{'content-type':'application/json'}}); };
await import(${JSON.stringify(new URL("../packages/cli/dist/index.js", import.meta.url).href)});\n`,
    );
    const budget = await portableRun({
      cli: bootstrap,
      cwd,
      report: budgetReport,
      expectedHead: budgetHead,
      location: "ci",
      executor: "github_actions",
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        OPENROUTER_API_KEY: "fixture-only-unused",
        PRQ_PROVIDER: "openrouter",
        PRQ_MODEL: "fixture/model",
      },
    });
    assert.equal(budget.exit_code, 2);
    assert.equal(await readFile(requested, "utf8"), "HTTP 402 injected");
    const budgetProof = JSON.parse(await readFile(budget.report, "utf8"));
    assert.equal(budgetProof.claims[0].verdict, "unverified");
    assert.ok(
      budgetProof.claims[0].evidence.some(
        (e) =>
          e.type === "command" && e.exit_code === 0 && e.stdout.includes("completed lint evidence"),
      ),
    );
    assert.ok(
      budgetProof.model_usage.some((u) => u.stage === "judge" && u.status === "unavailable"),
    );
    await assert.rejects(
      portableRun({ cli, cwd, report, expectedHead: "a".repeat(40), env }),
      /expected head/,
    );
    await writeFile(join(cwd, "source.txt"), "uncommitted change");
    await assert.rejects(
      portableRun({ cli, cwd, report, expectedHead: budgetHead, env }),
      /Commit tracked/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
