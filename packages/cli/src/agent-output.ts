import { coverageSummary, type ProofRequest, tokenCount, tokenExcerpt } from "@prq/core";

const bytes = (value: string) => new TextEncoder().encode(value).length;
export function clip(value: string, maxBytes: number): string {
  let out = "";
  for (const char of value) {
    if (bytes(out + char) > maxBytes) break;
    out += char;
  }
  return out;
}
type CompactRow =
  | { id: string; claimed: string; observed: string }
  | { id: string; claimed_excerpt: string; observed_excerpt: string; truncated: true };
export function fullJson(pr: ProofRequest, reportPath: string): string {
  return JSON.stringify({ ...pr, report: reportPath });
}
export function agentJson(pr: ProofRequest, reportPath: string): string {
  const broken = pr.claims.filter((c) => c.verdict === "broken");
  const output: {
    summary: ProofRequest["summary"];
    coverage?: string;
    broken: CompactRow[];
    omitted: number;
    report: string;
  } = {
    summary: pr.summary,
    broken: [],
    omitted: broken.length,
    report: reportPath,
    ...(pr.handoff?.task?.trim() ? { coverage: coverageSummary(pr) } : {}),
  };
  for (const claim of broken) {
    output.broken.push({
      id: claim.id,
      claimed: claim.text,
      observed: claim.observed ?? "See evidence",
    });
    output.omitted--;
    if (tokenCount(JSON.stringify(output)) > 299) {
      output.broken.pop();
      output.omitted++;
      if (!output.broken.length) {
        for (let budget = 70; budget >= 5; budget -= 5) {
          const excerpt: CompactRow = {
            id: claim.id,
            claimed_excerpt: tokenExcerpt(claim.text, budget),
            observed_excerpt: tokenExcerpt(claim.observed ?? "See evidence", budget),
            truncated: true,
          };
          output.broken.push(excerpt);
          output.omitted--;
          if (tokenCount(JSON.stringify(output)) <= 299) break;
          output.broken.pop();
          output.omitted++;
        }
      }
      break;
    }
  }
  return JSON.stringify(output);
}
