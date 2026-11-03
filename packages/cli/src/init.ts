import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const config = `import { openai } from '@ai-sdk/openai';
import { web } from '@e2e-dev/web';
export default {
  targets: [{ engine: web({ browser: 'chromium' }), app: { url: process.env.PRQ_APP_URL ?? 'http://localhost:3000' } }],
  agents: { default: { model: openai('gpt-6.1-sol'), judgmentTimeout: 60000 } },
  reporters: ['list', 'markdown'],
  cache: { mode: 'read-write', dir: '.e2e/cache' },
};
`;
const block = `<!-- prq:start -->
## Proof before done
Before reporting a task as done, pipe your done message into \`prq --from-stdin --json\`.
Keep one claim per sentence. Include the saved report path in your final message.
If a claim is broken, fix the code and run \`prq rerun\`. Never edit, omit, or weaken a locked claim.
<!-- prq:end -->`;
const hookScript = `import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
try {
  const event = JSON.parse(readFileSync(0, 'utf8'));
  if (event.stop_hook_active || typeof event.last_assistant_message !== 'string' || !event.last_assistant_message.trim()) {
    process.stdout.write('{}');
  } else {
    const run = spawnSync('prq', ['--from-stdin', '--summary', '--quiet'], { cwd: resolve(import.meta.dirname, '../..'), input: event.last_assistant_message, encoding: 'utf8', timeout: 180000 });
    let report;
    try { report = JSON.parse(run.stdout); } catch {}
    const summary = report?.summary;
    if (summary?.broken > 0) process.stdout.write(JSON.stringify({ decision: 'block', reason: 'prq found broken claims. Run prq fix, fix the code, then prq rerun. Keep the original claims.' }));
    else process.stdout.write(JSON.stringify({ systemMessage: summary ? 'prq: held ' + summary.held + ', broken ' + summary.broken + ', needs a human ' + summary.needs_human + ', unverified ' + summary.unverified + '. ' + report.report : 'prq could not run. Check provider credentials, model configuration and that prq is on PATH.' }));
  }
} catch { process.stdout.write(JSON.stringify({ systemMessage: 'prq hook could not read its input.' })); }
`;
async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (issue) {
    if (issue instanceof Error && "code" in issue && issue.code === "ENOENT") return;
    throw issue;
  }
}
async function writeMissing(path: string, text: string): Promise<boolean> {
  try {
    await writeFile(path, text, { flag: "wx" });
    return true;
  } catch (issue) {
    if (issue instanceof Error && "code" in issue && issue.code === "EEXIST") return false;
    throw issue;
  }
}
export async function initProject(root: string, hasCodex: boolean): Promise<string[]> {
  const notes: string[] = [];
  await mkdir(join(root, ".pr"), { recursive: true });
  notes.push(
    (await writeMissing(join(root, "e2e.config.ts"), config))
      ? "Created e2e.config.ts."
      : "Kept existing e2e.config.ts.",
  );
  const agentsPath = join(root, "AGENTS.md");
  const agents = (await readOptional(agentsPath)) ?? "";
  if (!agents.includes("<!-- prq:start -->"))
    await writeFile(agentsPath, `${agents.trimEnd()}\n\n${block}\n`.trimStart());
  const ignorePath = join(root, ".gitignore");
  const ignore = (await readOptional(ignorePath)) ?? "";
  const missing = [".pr/", ".e2e/", "tests/prq-*.e2e.ts", ".prq-*.config.mjs"].filter(
    (pattern) => !ignore.split("\n").includes(pattern),
  );
  if (missing.length)
    await writeFile(ignorePath, `${ignore.trimEnd()}\n${missing.join("\n")}\n`.trimStart());
  if (hasCodex) {
    await mkdir(join(root, ".codex", "hooks"), { recursive: true });
    const hooksPath = join(root, ".codex", "hooks.json");
    const Hooks = z
      .object({ hooks: z.record(z.string(), z.array(z.unknown())).default({}) })
      .passthrough();
    const raw = await readOptional(hooksPath);
    const hooks = Hooks.parse(raw ? JSON.parse(raw) : {});
    const existing = hooks.hooks.Stop ?? [];
    const Group = z
      .object({ hooks: z.array(z.object({ command: z.string().optional() }).passthrough()) })
      .passthrough();
    const configured = existing.some((value) => {
      const group = Group.safeParse(value);
      return (
        group.success && group.data.hooks.some((hook) => hook.command?.includes("prq-stop.mjs"))
      );
    });
    await writeMissing(join(root, ".codex", "hooks", "prq-stop.mjs"), hookScript);
    if (!configured) {
      hooks.hooks.Stop = [
        ...existing,
        {
          hooks: [
            {
              type: "command",
              command: 'node "$(git rev-parse --show-toplevel)/.codex/hooks/prq-stop.mjs"',
              timeout: 200,
              statusMessage: "Checking the agent's claims",
            },
          ],
        },
      ];
      await writeFile(hooksPath, `${JSON.stringify(hooks, null, 2)}\n`);
    }
    notes.push(
      "Created or kept the Codex Stop hook. Review it with /hooks in Codex; prq must be on PATH.",
    );
  }
  notes.push(
    "Set OPENAI_API_KEY, or OPENROUTER_API_KEY with PRQ_PROVIDER=openrouter and PRQ_MODEL. Start your app. Browser checks require e2e, @e2e-dev/web, and @ai-sdk/openai in this project; prq supplies its selected browser model independently.",
  );
  return notes;
}
