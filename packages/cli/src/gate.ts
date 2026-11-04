import { lockClaims, type ProofRequest, verificationExitCode } from "@prq/core";
import { execa } from "execa";
import { readHandoff } from "./handoff.js";
import { selectProject } from "./project.js";

/** Local workflow check, not an attestation or a GitHub enforcement service. */
export async function checkHandoff(root: string, pr: ProofRequest, claimsPath: string) {
  const expected = await readHandoff(claimsPath);
  const issues: string[] = [];
  if (lockClaims(pr.claims) !== pr.source.hash || lockClaims(expected.claims) !== pr.source.hash)
    issues.push("The report does not match the supplied locked claims.");
  if (
    !pr.handoff ||
    pr.source.text !== expected.source ||
    pr.handoff.task !== expected.task ||
    JSON.stringify(pr.handoff.unfinished) !== JSON.stringify(expected.unfinished)
  )
    issues.push("The report does not match this explicit builder handoff.");
  const head = (await execa("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
  if (head !== pr.subject.head)
    issues.push("The report covers a different commit. Rerun these claims.");
  await selectProject(root, pr.subject.project ?? ".");
  const status = await execa("git", ["status", "--porcelain", "--untracked-files=normal"], {
    cwd: root,
  });
  if (status.stdout.trim())
    issues.push(
      "The working tree has changes not covered by the committed source. Commit the changes and rerun.",
    );
  const outcome = verificationExitCode(pr, true);
  if (outcome !== 0)
    issues.push(
      "Claims are broken, unverified, awaiting a human decision, or the builder reports unfinished work.",
    );
  return {
    format: "prq-gate/v1",
    ready: issues.length === 0,
    run_id: pr.id,
    head: pr.subject.head,
    project: pr.subject.project ?? ".",
    claim_hash: pr.source.hash,
    issues,
    exitCode: issues.length ? (outcome === 1 ? 1 : 2) : 0,
  };
}
