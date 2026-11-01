import type { DraftClaim, Evidence } from "./schema.js";

export interface RunContext {
  /** Absolute path of the checkout to verify (a worktree of HEAD). */
  worktree: string;
  appUrl: string;
  runDir: string;
  timeoutMs: number;
  /** Stable locations shared by executions with the same locked claims. */
  cacheDir?: string;
  testFile?: string;
  /** Caller checkout for resolving installed browser tooling. */
  projectDir?: string;
  onProgress?: (claimId: string, message: string) => void;
}

export interface RunResult {
  /** Did the check itself pass? Undefined when nothing runnable happened (unverified). */
  passed?: boolean;
  /** A final assertion completed but could not settle the claim. Never use for infrastructure issues. */
  completed?: boolean;
  /** Recorded interactions and screen observations, without source code or raw process logs. */
  steps?: { action: string; observation?: string }[];
  observed?: string;
  evidence: Evidence[];
  tester: string;
  cached?: boolean;
  duration_ms: number;
}

export interface Runner {
  kind: DraftClaim["kind"];
  /** Run many claims of this kind at once; implementations may parallelise internally. */
  run(claims: DraftClaim[], ctx: RunContext): Promise<Map<string, RunResult>>;
}

export interface Store {
  put(runId: string, relPath: string, bytes: Uint8Array | string): Promise<string>;
  get(runId: string, relPath: string): Promise<Uint8Array>;
  list(runId: string): Promise<string[]>;
  root(runId: string): string;
}
