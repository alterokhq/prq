import { coverageIssues } from "./coverage.js";
import type { ProofRequest } from "./schema.js";
import { tokenCount } from "./tokens.js";
/** Full claims stay in the artifact. Omit whole rows rather than weakening their wording. */
export function fixPrompt(pr: ProofRequest): string {
  const broken = pr.claims.filter(
    (c) => c.verdict === "broken" || c.signoff?.decision === "rejected",
  );
  const gaps = coverageIssues(pr);
  if (!broken.length && !gaps.length) return "";
  const header = `Fix the code. Keep the claims locked at ${pr.source.hash.slice(7, 14)}.\n${gaps.length ? "Task coverage is unresolved. Inspect the requirements and selected checks in the report. Rerun assessment failures; add omitted promises in a NEW handoff and run, never by editing the old lock.\n" : ""}`;
  const footer = `\nFull evidence: .pr/runs/${pr.id}/proof-request.json\n${gaps.length ? "For unchanged claims, rerun from the repository root:" : "Then run from the repository root:"}\nprq rerun --run .pr/runs/${pr.id}/proof-request.json`;
  let body = "";
  let included = 0;
  for (const claim of broken) {
    const screenshot = claim.evidence?.find((e) => e.type === "screenshot")?.path;
    const row = `- claimed ${claim.text}\n+ observed ${claim.signoff?.decision === "rejected" ? `rejected by ${claim.signoff.by}: ${claim.signoff.reason ?? "see signoff"}` : (claim.observed ?? "see evidence")}\n${screenshot ? `screenshot: .pr/runs/${pr.id}/${screenshot}\n` : ""}`;
    const remaining = broken.length - included - 1;
    const tail = remaining ? `${remaining} more repair rows in the report.\n` : "";
    if (tokenCount(header + body + row + tail + footer) > 299) break;
    body += row;
    included++;
  }
  const omitted =
    included < broken.length ? `${broken.length - included} more repair rows in the report.\n` : "";
  return header + body + omitted + footer;
}
