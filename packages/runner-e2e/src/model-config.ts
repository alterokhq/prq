import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { RunContext } from "@prq/core";

/** A separate agent prevents a project's author context or executor overriding verification. */
export async function withModelConfig<T>(
  ctx: RunContext,
  run: (args: string[]) => Promise<T>,
): Promise<T> {
  if (!ctx.browserModel) return run([]);
  const base = ["ts", "mts", "js", "mjs"]
    .map((ext) => join(ctx.worktree, `e2e.config.${ext}`))
    .find((path) => existsSync(path));
  if (!base) throw new Error("Run prq init to prepare the browser configuration.");
  const { provider, model, modulePath } = ctx.browserModel;
  const factory = provider === "openrouter" ? "createOpenRouter" : "createOpenAI";
  const keyName = provider === "openrouter" ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY";
  // e2e resolves the project root from the config's directory. Keep this next to the
  // original config, give it a unique name, and remove only the file we created.
  const path = join(ctx.worktree, `.prq-${randomUUID()}.config.mjs`);
  const source = `import base from ${JSON.stringify(pathToFileURL(base).href)};
import { ${factory} } from ${JSON.stringify(pathToFileURL(modulePath).href)};
export default {
  ...base,
  targets: base.targets.map(target => ({ ...target, app: { ...target.app, url: process.env.PRQ_APP_URL } })),
  agents: { prq: { model: ${factory}({ apiKey: process.env.${keyName} })(${JSON.stringify(model)}), judgmentTimeout: ${Math.min(ctx.timeoutMs, 60000)} } },
};
`;
  await writeFile(path, source, { flag: "wx" });
  try {
    return await run(["--config", path, "--agent", "prq"]);
  } finally {
    await rm(path, { force: true });
  }
}
