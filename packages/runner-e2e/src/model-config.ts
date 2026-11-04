import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { RunContext } from "@prq/core";
import { execa } from "execa";

async function ignoreTemporaryConfig(root: string) {
  const result = await execa("git", ["rev-parse", "--git-path", "info/exclude"], {
    cwd: root,
    reject: false,
  });
  if (result.exitCode !== 0) return;
  const path = resolve(root, result.stdout.trim());
  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch (issue) {
    if (!(issue instanceof Error && "code" in issue && issue.code === "ENOENT")) throw issue;
  }
  if (!existing.split("\n").includes(".prq-*.config.mjs")) {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, "\n# prq temporary browser configuration\n.prq-*.config.mjs\n");
  }
}

/** A separate agent prevents a project's author context or executor overriding verification. */
export async function withModelConfig<T>(
  ctx: RunContext,
  run: (args: string[]) => Promise<T>,
): Promise<T> {
  if (!ctx.browserModel) return run([]);
  const project = ctx.projectDir ?? ctx.worktree;
  const base = ["ts", "mts", "js", "mjs"]
    .map((ext) => join(project, `e2e.config.${ext}`))
    .find((path) => existsSync(path));
  if (!base) throw new Error("Run prq init to prepare the browser configuration.");
  const { provider, model, modulePath } = ctx.browserModel;
  const factory = provider === "openrouter" ? "createOpenRouter" : "createOpenAI";
  const keyName = provider === "openrouter" ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY";
  // e2e resolves the project root from the config's directory. Keep this next to the
  // original config, give it a unique name, and remove only the file we created.
  const path = join(project, `.prq-${randomUUID()}.config.mjs`);
  const source = `import base from ${JSON.stringify(pathToFileURL(base).href)};
import { ${factory} } from ${JSON.stringify(pathToFileURL(modulePath).href)};
export default {
  ...base,
  targets: base.targets.map(target => ({ ...target, app: { ...target.app, url: process.env.PRQ_APP_URL } })),
  agents: { prq: { model: ${factory}({ apiKey: process.env.${keyName} })(${JSON.stringify(model)}), judgmentTimeout: ${Math.min(ctx.timeoutMs, 60000)} } },
};
`;
  await ignoreTemporaryConfig(ctx.worktree);
  await writeFile(path, source, { flag: "wx" });
  try {
    return await run(["--config", path, "--agent", "prq"]);
  } finally {
    await rm(path, { force: true });
  }
}
