import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import {
  applyVerdict,
  type Claim,
  classifyClaims,
  createModel,
  DraftClaim,
  extractClaims,
  judgeClaims,
  lockClaims,
  type ModelReceipt,
  type ModelUsage,
  modelUsage,
  type ProofRequest,
  type Runner,
  type RunResult,
  resolveProvider,
  runCost,
  shortHash,
  summarize,
} from "@prq/core";
import { e2eRunner } from "@prq/runner-e2e";
import { shellRunner } from "@prq/runner-shell";
import { execa } from "execa";
import { isVerificationCommand, verificationCommands } from "./commands.js";
import { readHandoff } from "./handoff.js";
import { selectProject } from "./project.js";
import { saveProof } from "./storage.js";
import { createTerminalView } from "./terminal.js";
export interface RunOptions {
  claims?: string;
  claimsJson?: string;
  project?: string;
  run?: string;
  strict?: boolean;
  fromStdin?: boolean;
  json?: boolean;
  summary?: boolean;
  quiet?: boolean;
  open?: boolean;
  appUrl?: string;
  timeout?: number;
  model?: string;
  provider?: string;
  judgeModel?: string;
  decisionMode?: string;
}
export class UsageIssue extends Error {}
export async function repoRoot(): Promise<string> {
  const result = await execa("git", ["rev-parse", "--show-toplevel"], { reject: false });
  if (result.exitCode !== 0)
    throw new UsageIssue("Run prq inside a git repository with a committed HEAD.");
  return result.stdout.trim();
}
export async function readStdin(): Promise<string> {
  let text = "";
  for await (const chunk of process.stdin) {
    text += String(chunk);
    if (text.length > 1_000_000)
      throw new UsageIssue("Source text is too large. Supply a shorter done message.");
  }
  return text;
}
async function sourceFor(
  root: string,
  options: RunOptions,
): Promise<{ kind: ProofRequest["source"]["kind"]; text: string }> {
  if (options.claims)
    return { kind: "file", text: await readFile(resolve(options.claims), "utf8") };
  if (options.fromStdin || !process.stdin.isTTY) {
    const text = await readStdin();
    if (text.trim() || options.fromStdin) return { kind: "agent_message", text };
  }
  const result = await execa("git", ["log", "-1", "--format=%B"], { cwd: root, reject: false });
  if (result.exitCode !== 0)
    throw new UsageIssue("No committed source found. Use --claims <file>.");
  return { kind: "commit", text: result.stdout };
}
function unverified(message: string): RunResult {
  return {
    observed: message,
    tester: "unavailable",
    evidence: [{ type: "note", text: message }],
    duration_ms: 0,
  };
}
async function screenshots(result: RunResult, runDir: string): Promise<string[]> {
  const paths = result.evidence.filter((e) => e.type === "screenshot" && e.path).map((e) => e.path);
  const selected = [...new Set([paths[0], paths.at(-1)])].filter(
    (path): path is string => typeof path === "string",
  );
  const output: string[] = [];
  for (const path of selected) {
    const absolute = isAbsolute(path) ? path : resolve(runDir, path);
    const inside = relative(runDir, absolute);
    if (inside.startsWith("..") || isAbsolute(inside)) continue;
    try {
      const bytes = await readFile(absolute);
      if (bytes.length > 10_000_000) continue;
      const mime = path.endsWith(".jpg") || path.endsWith(".jpeg") ? "image/jpeg" : "image/png";
      output.push(`data:${mime};base64,${bytes.toString("base64")}`);
    } catch {
      /* Missing image never becomes proof. */
    }
  }
  return output;
}
export async function runProof(
  root: string,
  options: RunOptions,
  previous?: ProofRequest,
): Promise<{ pr: ProofRequest; reportPath: string }> {
  const started = Date.now();
  const project = await selectProject(
    root,
    options.project ?? (previous ? (previous.subject.project ?? ".") : undefined),
  );
  if (previous && project.path !== (previous.subject.project ?? "."))
    throw new UsageIssue("Reruns must use the original report's project directory.");
  const handoff = options.claimsJson ? await readHandoff(resolve(options.claimsJson)) : undefined;
  const availableCommands = await verificationCommands(project.directory, root);
  const selection = resolveProvider(options, process.env);
  const model = createModel(selection);
  const judgeModel = createModel({ ...selection, model: selection.judgeModel });
  const decisionOptions =
    selection.decisionMode === "decisions"
      ? { apiKey: selection.apiKey, model: selection.judgeModel }
      : { languageModel: judgeModel };
  const usage: ModelUsage[] = [];
  const account = (stage: ModelUsage["stage"], name: string) => {
    const row = modelUsage({ stage, provider: selection.provider, model: name });
    usage.push(row);
    return (receipt: ModelReceipt) =>
      Object.assign(row, modelUsage({ stage, provider: selection.provider, model: name, receipt }));
  };
  const view = createTerminalView({ quiet: options.quiet, json: options.json || options.summary });
  view.prepare();
  try {
    const timeoutMs = options.timeout ?? 120_000;
    const appUrl =
      options.appUrl ??
      process.env.PRQ_APP_URL ??
      previous?.subject.app_url ??
      "http://localhost:3000";
    try {
      const url = new URL(appUrl);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    } catch {
      throw new UsageIssue("Use an http or https application URL.");
    }
    const head = (await execa("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
    const source =
      previous?.source ??
      (handoff ? { kind: "file" as const, text: handoff.source } : await sourceFor(root, options));
    let claims: DraftClaim[];
    if (previous) {
      claims = previous.claims.map((c) => DraftClaim.parse(c));
      if (lockClaims(claims) !== previous.source.hash)
        throw new UsageIssue(
          "The saved claims do not match their lock. Restore the original run before rerunning.",
        );
    } else if (handoff) {
      claims = handoff.claims;
    } else {
      claims = await extractClaims(source.text, {
        model,
        onUsage: account("extraction", selection.model),
        timeoutMs,
        commands: availableCommands,
      });
    }
    const hash = lockClaims(claims);
    const id = `${shortHash(hash)}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const runDir = join(root, ".pr", "runs", id);
    await mkdir(runDir, { recursive: true });
    await writeFile(
      join(runDir, "claims.lock.json"),
      `${JSON.stringify({ hash, claims }, null, 2)}\n`,
      { flag: "wx" },
    );
    if (!previous && !handoff) {
      try {
        let recordClassification: ((receipt: ModelReceipt) => void) | undefined;
        claims = await classifyClaims(claims, {
          ...(selection.decisionMode === "decisions" ? decisionOptions : { languageModel: model }),
          timeoutMs,
          onRequest: () => {
            recordClassification = account(
              "classification",
              selection.decisionMode === "decisions" ? selection.judgeModel : selection.model,
            );
          },
          onUsage: (receipt) => recordClassification?.(receipt),
        });
      } catch {
        /* Extracted routes remain explicit; execution still determines evidence. */
      }
    }
    if (lockClaims(claims) !== hash) throw new UsageIssue("Claim text changed after locking.");
    const subject = {
      repo: basename(root),
      head,
      title: source.text.split("\n")[0]?.slice(0, 120),
      app_url: appUrl,
      project: project.path,
    };
    view.start({ subject, claims, hash });
    const results = new Map<string, RunResult>();
    const completed = new Map<string, Claim>();
    for (const claim of claims.filter((c) => c.kind === "human")) {
      const human: Claim = { ...claim, verdict: "needs_human", assignee: null, signoff: null };
      completed.set(claim.id, human);
      view.resolve(human);
    }
    const runners: Runner[] = [e2eRunner, shellRunner];
    await Promise.all(
      runners.map(async (runner) => {
        const candidates = claims.filter((c) => c.kind === runner.kind);
        const routed = candidates.filter((c) => {
          if (c.kind !== "command" || isVerificationCommand(c.check?.command, availableCommands))
            return true;
          results.set(
            c.id,
            unverified(
              "No allowed verification command matched this claim. Available checks: " +
                (availableCommands.join(", ") || "none"),
            ),
          );
          return false;
        });
        if (!routed.length) return;
        let output: Map<string, RunResult>;
        try {
          output = await runner.run(routed, {
            worktree: root,
            projectDir: project.directory,
            head,
            appUrl,
            runDir,
            timeoutMs,
            cacheDir: join(project.directory, ".e2e", "cache"),
            testFile: join(project.directory, "tests", `prq-${shortHash(hash)}.e2e.ts`),
            onProgress: (id, message) => view.progress(id, message),
            onBrowserStart: () =>
              usage.push({
                stage: "browser",
                provider: selection.provider,
                model: selection.model,
                status: "external",
                input_tokens: null,
                output_tokens: null,
                cost_usd: null,
              }),
            ...(runner.kind === "browser"
              ? {
                  browserModel: {
                    provider: selection.provider,
                    model: selection.model,
                    modulePath: createRequire(import.meta.url).resolve(
                      selection.provider === "openrouter"
                        ? "@openrouter/ai-sdk-provider"
                        : "@ai-sdk/openai",
                    ),
                  },
                }
              : {}),
          });
        } catch {
          output = new Map();
        }
        for (const claim of routed) {
          const result =
            output.get(claim.id) ??
            unverified("The check did not produce a result. Check the runner setup and try again.");
          if (runner.kind === "browser")
            result.evidence.push({
              type: "note",
              text: `Checked externally running application at ${appUrl}. Its source revision was not verified against ${head}.`,
            });
          results.set(claim.id, result);
          view.progress(
            claim.id,
            result.passed === undefined ? "unverified" : "evidence collected; judging",
          );
        }
      }),
    );
    const inputs = await Promise.all(
      claims
        .filter((c) => c.kind !== "human")
        .map(async (claim) => {
          const result = results.get(claim.id) ?? unverified("No runnable check was produced.");
          return { claim, result, screenshotDataUrls: await screenshots(result, runDir) };
        }),
    );
    // The judge can reject a result without calling a model. Add accounting only
    // when it actually requests an independent assessment.
    let recordJudge: ((receipt: ModelReceipt) => void) | undefined;
    const judgments = await judgeClaims(inputs, {
      ...decisionOptions,
      timeoutMs,
      onUsage: (receipt) => recordJudge?.(receipt),
      onRequest: () => {
        recordJudge = account("judge", selection.judgeModel);
      },
    });
    for (const input of inputs) {
      const judgment = judgments.get(input.claim.id) ?? { verdict: "unverified" as const };
      if (judgment.verdict === "unverified" && input.result.passed !== undefined)
        input.result.evidence.push({
          type: "note",
          text: "Independent judgment was unavailable or the evidence was insufficient.",
        });
      const row = applyVerdict(
        input.claim,
        input.result,
        judgment,
        `${selection.provider} ${selection.decisionMode} ${selection.judgeModel}`,
      );
      completed.set(row.id, row);
      view.resolve(row);
    }
    const rows = claims.map(
      (c) =>
        completed.get(c.id) ??
        applyVerdict(c, unverified("No result recorded."), { verdict: "unverified" }),
    );
    const pr: ProofRequest = {
      version: "0.2",
      id,
      created_at: new Date().toISOString(),
      subject,
      source: { kind: source.kind, text: source.text, hash },
      ...(handoff
        ? {
            handoff: { format: handoff.format, task: handoff.task, unfinished: handoff.unfinished },
          }
        : previous?.handoff
          ? { handoff: previous.handoff }
          : {}),
      claims: rows,
      summary: summarize(rows),
      configuration: {
        provider: selection.provider,
        model: selection.model,
        judge_model: selection.judgeModel,
        decision_mode: selection.decisionMode,
      },
      model_usage: usage,
      timing: { total_ms: Date.now() - started, ...runCost(usage) },
    };
    const reportPath = await saveProof(root, pr);
    view.finish(pr, { reportPath });
    return { pr, reportPath };
  } finally {
    view.stop();
  }
}
