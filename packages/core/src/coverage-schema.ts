import { z } from "zod";

export const Requirement = z.object({
  id: z.string().regex(/^r[1-9]\d*$/),
  text: z.string().min(1).max(100_000),
});
export const RequirementCoverage = Requirement.extend({
  status: z.enum(["covered", "missing", "uncertain"]),
  claim_ids: z.array(z.string()).max(400),
  reason: z.string().min(1).max(2000),
});
export const CheckPlan = z.object({
  claim_id: z.string().min(1).max(80),
  kind: z.enum(["browser", "command", "human"]).nullable(),
  check: z
    .object({
      path: z.string().max(2000).nullable(),
      setup: z.string().max(4000).nullable(),
      command: z.string().max(4000).nullable(),
    })
    .nullable(),
  reason: z.string().min(1).max(2000),
});
const identity = { task_hash: z.string(), claim_hash: z.string() };
export const TaskCoverage = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_requested") }),
  z.object({
    status: z.literal("unavailable"),
    ...identity,
    requirements: z.array(Requirement).max(400),
    reason: z.string(),
  }),
  z.object({
    status: z.literal("assessed"),
    ...identity,
    requirements: z.array(RequirementCoverage).min(1).max(400),
    checks: z.array(CheckPlan).max(400),
  }),
]);
export type TaskCoverage = z.infer<typeof TaskCoverage>;
export type CheckPlan = z.infer<typeof CheckPlan>;
export type Requirement = z.infer<typeof Requirement>;
