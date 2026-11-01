import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lockClaims, shortHash } from "./lock.js";
import { ProofRequest, summarize } from "./schema.js";

const example = JSON.parse(
  readFileSync(new URL("../../../fixtures/example.json", import.meta.url), "utf8"),
);

describe("proof request schema", () => {
  it("accepts the example fixture", () => {
    const pr = ProofRequest.parse(example);
    expect(pr.claims).toHaveLength(6);
    expect(summarize(pr.claims)).toEqual(pr.summary);
  });
  it("preserves exact claim wording in the lock", () => {
    const a = lockClaims([{ id: "c1", text: "Users can vote", kind: "browser" }]);
    const b = lockClaims([{ id: "c1", text: "users can vote ", kind: "command" }]);
    expect(a).not.toBe(b);
    expect(shortHash(a)).toHaveLength(7);
  });
});
