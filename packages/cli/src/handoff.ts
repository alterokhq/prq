import { readFile } from "node:fs/promises";
import { ClaimsHandoff } from "@prq/core";

export class HandoffIssue extends Error {}
export async function readHandoff(path: string): Promise<ClaimsHandoff> {
  try {
    const text = await readFile(path, "utf8");
    if (text.length > 2_000_000) throw new Error();
    const parsed = ClaimsHandoff.safeParse(JSON.parse(text));
    if (!parsed.success)
      throw new HandoffIssue(
        `Invalid claims handoff: ${parsed.error.issues[0]?.message ?? "check the prq-claims/v1 format"}.`,
      );
    return parsed.data;
  } catch (issue) {
    if (issue instanceof HandoffIssue) throw issue;
    throw new HandoffIssue(
      "Could not read a valid claims JSON file. Use the prq-claims/v1 format.",
    );
  }
}
