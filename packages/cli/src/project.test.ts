import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { expect, it } from "vitest";
import { verificationCommands } from "./commands.js";
import { initProject } from "./init.js";
import { selectProject } from "./project.js";

it("selects nested projects, rejects outside paths and nested repositories", async () => {
  const root = await mkdtemp(join(tmpdir(), "prq-project-"));
  const outside = await mkdtemp(join(tmpdir(), "prq-outside-"));
  try {
    await execa("git", ["init"], { cwd: root });
    await mkdir(join(root, "services", "api"), { recursive: true });
    expect(await selectProject(root, "services/api")).toEqual({
      directory: await realpath(join(root, "services", "api")),
      path: "services/api",
    });
    await expect(selectProject(root, outside)).rejects.toThrow("inside");
    await symlink(outside, join(root, "external"));
    await expect(selectProject(root, "external")).rejects.toThrow("inside");
    await expect(selectProject(root, "missing")).rejects.toThrow("existing");
    await execa("git", ["init"], { cwd: join(root, "services", "api") });
    await expect(selectProject(root, "services/api")).rejects.toThrow("nested repository");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

it("inherits the repository package manager and supports explicit non-JavaScript commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "prq-command-project-"));
  try {
    const project = join(root, "service");
    await mkdir(project);
    await writeFile(join(root, "package.json"), JSON.stringify({ packageManager: "pnpm@11" }));
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" } }),
    );
    expect(await verificationCommands(project, root)).toEqual(["pnpm run test"]);
    await rm(join(project, "package.json"));
    expect(await verificationCommands(project, root)).toEqual([]);
    await writeFile(
      join(project, "prq.config.json"),
      JSON.stringify({ commands: ["python3 -m pytest", "go test ./..."] }),
    );
    expect(await verificationCommands(project, root)).toEqual([
      "python3 -m pytest",
      "go test ./...",
    ]);
    await writeFile(join(project, "prq.config.json"), "{}");
    await expect(verificationCommands(project, root)).rejects.toThrow("Invalid prq.config.json");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("writes nested configuration and selects the same project from its generated hook", async () => {
  const root = await mkdtemp(join(tmpdir(), "prq-init-project-"));
  try {
    const project = join(root, "service");
    await mkdir(project);
    await initProject(root, true, project);
    const { readFile } = await import("node:fs/promises");
    expect(await readFile(join(project, "e2e.config.ts"), "utf8")).toContain("export default");
    await expect(readFile(join(root, "e2e.config.ts"))).rejects.toThrow();
    expect(await readFile(join(root, ".codex", "hooks", "prq-stop.mjs"), "utf8")).toContain(
      '"--project","service"',
    );
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain(
      "prq --project 'service' --claims-json",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
