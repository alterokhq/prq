import type { ProofRequest } from "./schema.js";
import { tokenCount } from "./tokens.js";
/** Full claims stay in the artifact. Omit whole rows rather than weakening their wording. */
export function fixPrompt(pr: ProofRequest): string {
  const broken = pr.claims.filter((c) => c.verdict === "broken");
  if (!broken.length) return "";
  const header = `Fix the code. Keep the claims locked at ${pr.source.hash.slice(7, 14)}.\n`;
  const footer = `\nFull evidence: .pr/runs/${pr.id}/proof-request.json\nThen run prq rerun.`;
  let body = "";
  let included = 0;
  for (const claim of broken) {
    const screenshot = claim.evidence?.find((e) => e.type === "screenshot")?.path;
    const row = `- claimed ${claim.text}\n+ observed ${claim.observed ?? "see evidence"}\n${screenshot ? `screenshot: .pr/runs/${pr.id}/${screenshot}\n` : ""}`;
    const remaining = broken.length - included - 1;
    const tail = remaining ? `${remaining} more broken rows in the report.\n` : "";
    if (tokenCount(header + body + row + tail + footer) > 299) break;
    body += row;
    included++;
  }
  const omitted =
    included < broken.length ? `${broken.length - included} more broken rows in the report.\n` : "";
  return header + body + omitted + footer;
}
