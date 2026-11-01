import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
