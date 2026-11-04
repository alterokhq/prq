import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { withModelConfig } from "./model-config.js";

describe("independent browser model configuration", () => {
  it.each([
    ["openai", "."],
    ["openrouter", "."],
    ["openai", "service"],
    ["openrouter", "service"],
  ] as const)(
    "uses %s in project %s without modifying its configuration",
    async (provider, selected) => {
      const root = await mkdtemp(join(tmpdir(), "prq-model-config-"));
      try {
        await execa("git", ["init"], { cwd: root });
        const project = join(root, selected);
        await mkdir(project, { recursive: true });
        const original =
          'export default { targets: [{ app: { url: "http://original", identity: "fixture" }, engine: "fixture" }], agents: { default: { context: "author context", model: "old" } }, workers: 2 };';
        await writeFile(join(project, "e2e.config.mjs"), original);
        const modulePath = join(root, "provider.mjs");
        await writeFile(
          modulePath,
          'export const createOpenAI = () => model => ({ provider: "openai", model }); export const createOpenRouter = () => model => ({ provider: "openrouter", model });',
        );
        await expect(
          withModelConfig(
            {
              worktree: root,
              projectDir: project,
              runDir: root,
              appUrl: "http://target",
              timeoutMs: 120000,
              browserModel: { provider, model: "selected/model", modulePath },
            },
            async (args) => {
              const path = args[1];
              if (!path) throw new Error("missing configuration");
              expect(path.startsWith(project)).toBe(true);
              expect(args.slice(2)).toEqual(["--agent", "prq"]);
              const ignored = await execa("git", ["check-ignore", path], { cwd: root });
              expect(ignored.exitCode).toBe(0);
              const source = await readFile(path, "utf8");
              expect(source).toContain(
                provider === "openrouter"
                  ? "process.env.OPENROUTER_API_KEY"
                  : "process.env.OPENAI_API_KEY",
              );
              const config = (await import(pathToFileURL(path).href)).default;
              expect(config.agents).toEqual({
                prq: { model: { provider, model: "selected/model" }, judgmentTimeout: 60000 },
              });
              expect(config.workers).toBe(2);
              expect(config.targets[0].app.identity).toBe("fixture");
              throw new Error("simulated runner failure");
            },
          ),
        ).rejects.toThrow("simulated runner failure");
        expect(await readFile(join(project, "e2e.config.mjs"), "utf8")).toBe(original);
        expect((await readdir(project)).some((path) => path.startsWith(".prq-"))).toBe(false);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
