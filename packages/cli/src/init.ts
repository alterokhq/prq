import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
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
function instructionBlock(project: string) {
  const projectArg = `'${project.replaceAll("'", "'\\''")}'`;
  return `<!-- prq:start -->
## Proof before PR
Before opening a PR, commit the change and write an explicit JSON handoff to .pr/claims.json.
Use format "prq-claims/v1", the original task in "task", your full done message in "source",
an "unfinished" array, and "claims" with stable id, verbatim text, kind (command, browser, human),
and optional check.command or check.path. Include every promise, not just passing checks.
Run \`prq --project ${projectArg} --claims-json .pr/claims.json --strict --summary\` from the repository root.
Keep the returned report path. Fix problems, commit, then run \`prq rerun --run <report> --strict --summary\`.
Never edit, omit, or weaken locked claims. Inspect the full report with \`prq show <report> --json\`.
Before creating the PR, require \`prq gate <report> --claims-json .pr/claims.json --json\` to exit 0.
Include the report path and any named human exceptions in the PR. Instructions alone do not enforce this gate.
For an informal done-message check, use \`prq --from-stdin --summary\`; this is not the explicit PR handoff.
<!-- prq:end -->`;
}
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
export async function initProject(
  root: string,
  hasCodex: boolean,
  project = root,
): Promise<string[]> {
  const notes: string[] = [];
  const projectPath = relative(root, project).split(sep).join("/") || ".";
  const block = instructionBlock(projectPath);
  const selectedHook =
    projectPath === "."
      ? hookScript
      : hookScript.replace("['--from-stdin', '--summary', '--quiet']", () =>
          JSON.stringify(["--from-stdin", "--summary", "--quiet", "--project", projectPath]),
        );
  await mkdir(join(root, ".pr"), { recursive: true });
  notes.push(
    (await writeMissing(join(project, "e2e.config.ts"), config))
      ? "Created e2e.config.ts in the selected project."
      : "Kept existing e2e.config.ts in the selected project.",
  );
  const agentsPath = join(root, "AGENTS.md");
  const agents = (await readOptional(agentsPath)) ?? "";
  if (/<!-- prq:start -->[\s\S]*?<!-- prq:end -->/.test(agents)) {
    await writeFile(
      agentsPath,
      agents.replace(/<!-- prq:start -->[\s\S]*?<!-- prq:end -->/, () => block),
    );
  } else if (!agents.includes("<!-- prq:start -->")) {
    await writeFile(agentsPath, `${agents.trimEnd()}\n\n${block}\n`.trimStart());
  } else {
    notes.push("Incomplete prq instruction markers in AGENTS.md; repair them and rerun init.");
  }
  const ignorePath = join(root, ".gitignore");
  const ignore = (await readOptional(ignorePath)) ?? "";
  const missing = [".pr/", ".e2e/", "**/tests/prq-*.e2e.ts", ".prq-*.config.mjs"].filter(
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
    const scriptPath = join(root, ".codex", "hooks", "prq-stop.mjs");
    const installedScript = await readOptional(scriptPath);
    const legacyScript = hookScript
      .replace(
        "['--from-stdin', '--summary', '--quiet']",
        "['--from-stdin', '--json', '--quiet', '--no-open']",
      )
      .replace(
        "Check provider credentials, model configuration and that prq is on PATH.",
        "Check OPENAI_API_KEY and that prq is on PATH.",
      );
    if (installedScript === legacyScript || installedScript === hookScript)
      await writeFile(scriptPath, selectedHook);
    else if (installedScript === undefined) await writeMissing(scriptPath, selectedHook);
    else if (installedScript !== selectedHook)
      notes.push("Kept customized prq-stop.mjs. Use --summary there to keep agent output bounded.");
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
