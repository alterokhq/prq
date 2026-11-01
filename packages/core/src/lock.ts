import { createHash } from "node:crypto";
import type { DraftClaim } from "./schema.js";

/** Canonical form: ids and texts only, in order. Checks may be refined later; the promise may not. */
export function lockClaims(claims: DraftClaim[]): string {
  const canonical = JSON.stringify(claims.map((c) => [c.id, c.text]));
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function shortHash(hash: string): string {
  return hash.replace(/^sha256:/, "").slice(0, 7);
}
