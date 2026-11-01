import { describe, expect, it } from "vitest";
import { decide } from "./decisions.js";
import { judgeClaims } from "./judge.js";
import { lockClaims } from "./lock.js";
import type { DraftClaim } from "./schema.js";

const claim: DraftClaim = { id: "c1", text: "A search box appears", kind: "browser" };
const response =
  (answers: unknown[]): typeof fetch =>
  async () =>
    new Response(JSON.stringify({ answers }));
const checked = {
  passed: true,
  evidence: [{ type: "assertion" as const, passed: true, text: "visible" }],
  tester: "fixture",
  duration_ms: 1,
};
describe("claim integrity", () => {
  it("locks text and order independently of routing", () => {
    expect(lockClaims([claim])).toBe(
      lockClaims([{ ...claim, kind: "human", check: { path: "/new" } }]),
    );
    expect(lockClaims([claim])).not.toBe(lockClaims([{ ...claim, text: `${claim.text} ` }]));
  });
});
describe("judge evidence", () => {
  it.each([
    [0.8, "held"],
    [0.3, "broken"],
    [0.5, "needs_human"],
  ])("applies probability %s", async (probability, verdict) => {
    const out = await judgeClaims(
      [{ claim, result: checked, screenshotDataUrl: "data:image/png;base64,fixture" }],
      {
        apiKey: "test",
        fetchImpl: response([{ type: "predicate", name: "c1", probability }]),
      },
    );
    expect(out.get("c1")?.verdict).toBe(verdict);
  });
  it("does not fabricate a negative probability when the judge omits an answer", async () => {
    const out = await judgeClaims(
      [{ claim, result: checked, screenshotDataUrl: "data:image/png;base64,fixture" }],
      {
        apiKey: "test",
        fetchImpl: response([]),
      },
    );
    expect(out.get("c1")).toMatchObject({ verdict: "unverified" });
    expect(out.get("c1")?.probability).toBeUndefined();
  });
  it("retains a contradicted execution when the judge is unavailable", async () => {
    const out = await judgeClaims([{ claim, result: { ...checked, passed: false } }]);
    expect(out.get("c1")).toMatchObject({ verdict: "broken" });
  });
  it("requires actual completed evidence", async () => {
    const out = await judgeClaims([
      { claim, result: { ...checked, evidence: [] } },
      {
        claim: { ...claim, id: "c2", kind: "human" },
        result: checked,
        screenshotDataUrl: "data:image/png;base64,fixture",
      },
    ]);
    expect(out.get("c1")?.verdict).toBe("unverified");
    expect(out.get("c2")?.verdict).toBe("needs_human");
  });
});
describe("Decisions boundary", () => {
  it("rejects duplicate answers", async () => {
    const answer = { type: "predicate", name: "c1", probability: 0.9 };
    await expect(
      decide("judge", [{ type: "predicate", name: "c1", instructions: "check" }], {
        apiKey: "test",
        fetchImpl: response([answer, answer]),
      }),
    ).rejects.toThrow("duplicate");
  });
  it("does not surface HTTP bodies", async () => {
    await expect(
      decide("judge", [{ type: "predicate", name: "c1", instructions: "check" }], {
        apiKey: "test",
        fetchImpl: async () => new Response("secret body", { status: 401 }),
      }),
    ).rejects.toThrow("HTTP 401");
  });
});

describe("independent observations", () => {
  it("cannot hold a browser claim from an assertion flag alone", async () => {
    const out = await judgeClaims([{ claim, result: checked }], {
      apiKey: "test",
      fetchImpl: response([{ type: "predicate", name: "c1", probability: 1 }]),
    });
    expect(out.get("c1")).toMatchObject({ verdict: "unverified" });
    expect(out.get("c1")?.probability).toBeUndefined();
  });
  it("keeps source-like command output out of the judge context", async () => {
    let body = "";
    const out = await judgeClaims(
      [
        {
          claim: { ...claim, text: "All tests pass.", kind: "command" },
          result: {
            ...checked,
            evidence: [
              {
                type: "command",
                command: "npm test",
                exit_code: 0,
                stdout: "private implementation codeframe",
              },
            ],
          },
        },
      ],
      {
        apiKey: "test",
        fetchImpl: async (_url, init) => {
          body = String(init?.body);
          return new Response(
            JSON.stringify({ answers: [{ type: "predicate", name: "c1", probability: 1 }] }),
          );
        },
      },
    );
    expect(body).not.toContain("private implementation");
    expect(body).toContain("exit_code");
    expect(out.get("c1")?.verdict).toBe("held");
  });
});

describe("completed ambiguous assertions", () => {
  it.each([
    [0.2, "broken"],
    [0.5, "needs_human"],
    [0.95, "needs_human"],
  ])("judges ambiguity at %s without claiming held", async (probability, verdict) => {
    let request = "";
    const result = {
      completed: true,
      evidence: [],
      steps: [
        {
          action: "Enter DARK",
          observation: "Dark mode was visible before entry; no matches after entry",
        },
      ],
      tester: "browser",
      duration_ms: 1,
    };
    const out = await judgeClaims(
      [
        {
          claim,
          result,
          screenshotDataUrls: ["data:image/png;base64,before", "data:image/png;base64,after"],
        },
      ],
      {
        apiKey: "test",
        fetchImpl: async (_url, init) => {
          request = String(init?.body);
          return new Response(
            JSON.stringify({ answers: [{ type: "predicate", name: "c1", probability }] }),
          );
        },
      },
    );
    expect(out.get("c1")?.verdict).toBe(verdict);
    expect(request).toContain("Enter DARK");
    expect(request).toContain("base64,before");
    expect(request).toContain("base64,after");
  });
  it("does not judge provider timeouts even if screenshots exist", async () => {
    let called = false;
    const out = await judgeClaims(
      [
        {
          claim,
          result: {
            evidence: [{ type: "note", text: "Provider timeout" }],
            tester: "browser",
            duration_ms: 1,
          },
          screenshotDataUrls: ["data:image/png;base64,before"],
        },
      ],
      {
        apiKey: "test",
        fetchImpl: async () => {
          called = true;
          return new Response("{}");
        },
      },
    );
    expect(called).toBe(false);
    expect(out.get("c1")?.verdict).toBe("unverified");
  });
});
