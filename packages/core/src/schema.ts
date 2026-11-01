import { z } from "zod";

export const ClaimKind = z.enum(["browser", "command", "human"]);
export const Verdict = z.enum(["held", "broken", "needs_human", "unverified"]);

export const Evidence = z.object({
  type: z.enum(["screenshot", "assertion", "http", "console", "command", "note"]),
  path: z.string().optional(),
  step: z.number().int().optional(),
  text: z.string().optional(),
  passed: z.boolean().optional(),
  method: z.string().optional(),
  url: z.string().optional(),
  status: z.number().int().optional(),
  level: z.string().optional(),
  command: z.string().optional(),
  exit_code: z.number().int().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
});

export const Signoff = z.object({
  by: z.string(),
  decision: z.enum(["accepted", "rejected"]),
  reason: z.string().optional(),
  at: z.iso.datetime(),
});

export const Claim = z.object({
  id: z
    .string()
    .max(80)
    .regex(/^[A-Za-z0-9_-]+$/),
  text: z.string().min(1),
  kind: ClaimKind,
  check: z
    .object({
      path: z.string().optional(),
      setup: z.string().optional(),
      command: z.string().optional(),
    })
    .optional(),
  verdict: Verdict,
  probability: z.number().min(0).max(1).optional(),
  observed: z.string().optional(),
  evidence: z.array(Evidence).optional(),
  tester: z.string().optional(),
  judge: z.string().optional(),
  duration_ms: z.number().int().optional(),
  cached: z.boolean().optional(),
  assignee: z.string().nullable().optional(),
  signoff: Signoff.nullable().optional(),
});

export const ProofRequest = z.object({
  version: z.literal("0.1"),
  id: z
    .string()
    .max(80)
    .regex(/^[A-Za-z0-9_-]+$/),
  created_at: z.iso.datetime(),
  subject: z.object({
    repo: z.string().optional(),
    base: z.string().optional(),
    head: z.string(),
    title: z.string().optional(),
    app_url: z.string().optional(),
  }),
  source: z.object({
    kind: z.enum(["agent_message", "commit", "pr_body", "plan", "file"]),
    text: z.string(),
    hash: z.string(),
  }),
  claims: z.array(Claim),
  summary: z.object({
    held: z.number().int(),
    broken: z.number().int(),
    needs_human: z.number().int(),
    unverified: z.number().int(),
  }),
  code: z.object({ diff_url: z.string().optional() }).optional(),
  timing: z
    .object({ total_ms: z.number().int().optional(), cost_usd: z.number().optional() })
    .optional(),
});

export type ClaimKind = z.infer<typeof ClaimKind>;
export type Verdict = z.infer<typeof Verdict>;
export type Evidence = z.infer<typeof Evidence>;
export type Claim = z.infer<typeof Claim>;
export type ProofRequest = z.infer<typeof ProofRequest>;

/** A claim before it has been checked: what extract() produces. */
export const DraftClaim = Claim.pick({ id: true, text: true, kind: true, check: true });
export type DraftClaim = z.infer<typeof DraftClaim>;

export function summarize(claims: Claim[]): ProofRequest["summary"] {
  const s = { held: 0, broken: 0, needs_human: 0, unverified: 0 };
  for (const c of claims) s[c.verdict] += 1;
  return s;
}
