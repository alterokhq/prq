import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";
import { shellRunner } from "./index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function repository() {
  const root = await mkdtemp(join(tmpdir(), "prq-shell-test-"));
  roots.push(root);
  await execa("git", ["init", "-q", root]);
  await writeFile(join(root, "state.txt"), "committed");
  await execa("git", ["add", "state.txt"], { cwd: root });
  await execa(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "Create fixture",
    ],
    { cwd: root },
  );
  return root;
}

describe("shell runner", () => {
  it("executes in a nested project and rebases pnpm and sibling workspace links into the captured commit", async () => {
    const root = await repository();
    const project = join(root, "service");
    const sibling = join(root, "packages", "helper");
    await mkdir(project);
    await mkdir(sibling, { recursive: true });
    for (const dir of [root, project, sibling]) await writeFile(join(dir, "package.json"), "{}");
    await writeFile(join(sibling, "value.txt"), "committed sibling");
    await writeFile(
      join(project, "check.cjs"),
      `
const fs = require('node:fs');
const assert = require('node:assert/strict');
assert.equal(fs.readFileSync('node_modules/helper/value.txt', 'utf8'), 'committed sibling');
assert.equal(fs.readFileSync('node_modules/dependency/value.txt', 'utf8'), 'dependency');
fs.writeFileSync('node_modules/helper/value.txt', 'changed by test');
fs.writeFileSync('node_modules/dependency/value.txt', 'changed by test');
console.log('nested workspace passed');
`,
    );
    await execa("git", ["add", "."], { cwd: root });
    await execa(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-qm",
        "Nested project",
      ],
      { cwd: root },
    );
    const head = (await execa("git", ["rev-parse", "HEAD"], { cwd: root })).stdout;
    await writeFile(join(sibling, "value.txt"), "later commit");
    await execa("git", ["add", "."], { cwd: root });
    await execa(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-qm",
        "Later source",
      ],
      { cwd: root },
    );
    const installed = join(
      root,
      "node_modules",
      ".pnpm",
      "dependency",
      "node_modules",
      "dependency",
    );
    await mkdir(installed, { recursive: true });
    await writeFile(join(installed, "value.txt"), "dependency");
    await mkdir(join(project, "node_modules"));
    await symlink("../../packages/helper", join(project, "node_modules", "helper"));
    await symlink(
      "../../node_modules/.pnpm/dependency/node_modules/dependency",
      join(project, "node_modules", "dependency"),
    );
    const results = await shellRunner.run(
      [
        {
          id: "nested",
          text: "The workspace check passes",
          kind: "command",
          check: { command: "node check.cjs" },
        },
      ],
      { worktree: root, projectDir: project, head, runDir: root, appUrl: "", timeoutMs: 10000 },
    );
    expect(results.get("nested")?.passed).toBe(true);
    expect(results.get("nested")?.evidence.find((e) => e.type === "command")?.stdout).toBe(
      "nested workspace passed",
    );
    expect(await readFile(join(sibling, "value.txt"), "utf8")).toBe("later commit");
    expect(await readFile(join(installed, "value.txt"), "utf8")).toBe("dependency");
  });

  it("leaves an uncommitted project unverified", async () => {
    const root = await repository();
    await mkdir(join(root, "new-project"));
    const results = await shellRunner.run(
      [
        {
          id: "missing",
          text: "The check runs",
          kind: "command",
          check: { command: "echo should-not-run" },
        },
      ],
      {
        worktree: root,
        projectDir: join(root, "new-project"),
        runDir: root,
        appUrl: "",
        timeoutMs: 5000,
      },
    );
    expect(results.get("missing")?.passed).toBeUndefined();
    expect(results.get("missing")?.evidence.some((e) => e.type === "command")).toBe(false);
  });

  it("checks committed HEAD, isolates writes, and removes the detached worktree", async () => {
    const root = await repository();
    await writeFile(join(root, "state.txt"), "uncommitted");
    const before = await execa("git", ["worktree", "list", "--porcelain"], { cwd: root });
    const results = await shellRunner.run(
      [
        {
          id: "c1",
          text: "The committed state is available",
          kind: "command",
          check: { command: "cat state.txt; echo changed > state.txt" },
        },
      ],
      { worktree: root, appUrl: "", runDir: root, timeoutMs: 5000 },
    );
    expect(results.get("c1")?.passed).toBe(true);
    expect(results.get("c1")?.evidence.find((item) => item.type === "command")?.stdout).toBe(
      "committed",
    );
    expect(await readFile(join(root, "state.txt"), "utf8")).toBe("uncommitted");
    expect((await execa("git", ["worktree", "list", "--porcelain"], { cwd: root })).stdout).toBe(
      before.stdout,
    );
  });

  it("distinguishes a contradicted command from an unavailable executable", async () => {
    const root = await repository();
    const results = await shellRunner.run(
      [
        { id: "broken", text: "The check holds", kind: "command", check: { command: "exit 3" } },
        {
          id: "missing",
          text: "The tool runs",
          kind: "command",
          check: { command: "prq_executable_that_does_not_exist" },
        },
      ],
      { worktree: root, appUrl: "", runDir: root, timeoutMs: 5000 },
    );
    expect(results.get("broken")?.passed).toBe(false);
    expect(results.get("missing")?.passed).toBeUndefined();
  });

  it("copies dependencies so a command cannot rewrite the source dependency directory", async () => {
    const root = await repository();
    await writeFile(join(root, "package.json"), '{"name":"isolation-fixture"}');
    await execa("git", ["add", "package.json"], { cwd: root });
    await execa(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-qm",
        "Add package",
      ],
      { cwd: root },
    );
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "node_modules", "state.txt"), "original");
    const results = await shellRunner.run(
      [
        {
          id: "c1",
          text: "Dependencies are isolated",
          kind: "command",
          check: { command: "echo changed > node_modules/state.txt" },
        },
      ],
      { worktree: root, appUrl: "", runDir: root, timeoutMs: 5000 },
    );
    expect(results.get("c1")?.passed).toBe(true);
    expect(await readFile(join(root, "node_modules", "state.txt"), "utf8")).toBe("original");
  });

  it("runs dependency-free package commands without node_modules", async () => {
    const root = await repository();
    await writeFile(join(root, "package.json"), '{"name":"dependency-free"}');
    await execa("git", ["add", "package.json"], { cwd: root });
    await execa(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-qm",
        "Add package",
      ],
      { cwd: root },
    );
    const results = await shellRunner.run(
      [
        {
          id: "c1",
          text: "The command runs",
          kind: "command",
          check: { command: "node -e 'process.exit(0)'" },
        },
      ],
      { worktree: root, appUrl: "", runDir: root, timeoutMs: 5000 },
    );
    expect(results.get("c1")?.passed).toBe(true);
  });

  it("does not inherit the verifier's API credential", async () => {
    const root = await repository();
    const results = await shellRunner.run(
      [
        {
          id: "c1",
          text: "Credentials are absent",
          kind: "command",
          check: { command: 'test -z "$OPENAI_API_KEY"' },
        },
      ],
      { worktree: root, appUrl: "", runDir: root, timeoutMs: 5000 },
    );
    expect(results.get("c1")?.passed).toBe(true);
  });
});
