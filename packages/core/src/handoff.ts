import { z } from "zod";
import { coverageIssues } from "./coverage.js";
import { DraftClaim, type ProofRequest } from "./schema.js";

export const ClaimsHandoff = z
  .object({
    format: z.literal("prq-claims/v1"),
    source: z.string().min(1).max(1_000_000),
    task: z.string().max(100_000).optional(),
    unfinished: z.array(z.string().trim().min(1).max(10_000)).max(100).default([]),
    claims: z.array(DraftClaim.strict()).min(1).max(400),
  })
  .strict()
  .superRefine((handoff, ctx) => {
    if (new Set(handoff.claims.map((c) => c.id)).size !== handoff.claims.length)
      ctx.addIssue({ code: "custom", message: "Claim IDs must be unique", path: ["claims"] });
    handoff.claims.forEach((claim, index) => {
      if (!claim.text.trim() || !handoff.source.includes(claim.text))
        ctx.addIssue({
          code: "custom",
          message: "Each claim must occur verbatim in source",
          path: ["claims", index, "text"],
        });
    });
  });
export type ClaimsHandoff = z.infer<typeof ClaimsHandoff>;

/** Inspect rows, not potentially stale summary counters. */
export function verificationExitCode(pr: ProofRequest, strict = false): 0 | 1 | 2 {
  if (
    pr.claims.some((c) => c.verdict === "broken" || (strict && c.signoff?.decision === "rejected"))
  )
    return 1;
  if (pr.claims.some((c) => c.verdict === "unverified")) return 2;
  if (
    strict &&
    (!pr.claims.length ||
      coverageIssues(pr).length > 0 ||
      pr.handoff?.unfinished.length ||
      pr.claims.some(
        (c) =>
          c.verdict === "needs_human" &&
          !(c.signoff?.decision === "accepted" && c.signoff.by.trim()),
      ))
  )
    return 2;
  return 0;
}
