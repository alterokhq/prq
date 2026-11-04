import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { afterEach, expect, it } from "vitest";
import { shellRunner } from "./index.js";
import { collectTestReport, prepareTestReport } from "./test-report.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "prq-test-evidence-"));
  roots.push(root);
  await execa("git", ["init", "-q", root]);
  return root;
}
function report(token: string, attachments: { name: string; path: string }[] = []) {
  return {
    format: "prq-test-results/v1",
    framework: "fixture",
    run_token: token,
    complete: true,
    errors: 0,
    tests: [{ name: "assertion", status: "passed", attempts: 1, attachments }],
  };
}
async function commit(root: string) {
  await execa("git", ["add", "."], { cwd: root });
  await execa(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "Fixture",
    ],
    { cwd: root },
  );
}
it("collects fresh results and bounded attachments while excluding external files", async () => {
  const root = await fixture();
  const prepared = await prepareTestReport(root, "results/suite.json");
  const outside = await fixture();
  await writeFile(join(outside, "private.txt"), "outside");
  await writeFile(join(root, "trace.txt"), "actual trace");
  await symlink(join(outside, "private.txt"), join(root, "escape.txt"));
  await writeFile(
    prepared.target,
    JSON.stringify(
      report(prepared.token, [
        { name: "trace", path: "trace.txt" },
        { name: "outside", path: "escape.txt" },
      ]),
    ),
  );
  const collected = await collectTestReport({
    project: root,
    ...prepared,
    runDir: join(root, "run"),
    claimId: "c1",
  });
  expect(collected.summary).toMatchObject({ passed: 1, executed: 1, complete: true });
  expect(await readFile(join(root, "run/evidence/c1/attachment-0"), "utf8")).toBe("actual trace");
  const saved = JSON.parse(await readFile(join(root, "run", collected.path), "utf8"));
  expect(saved.tests[0].attachments[1].path).toBe("unavailable");
  expect(collected.notes).toHaveLength(1);
});
it.each(["stale", "malformed", "missing", "oversized", "symlink"])(
  "rejects %s reports",
  async (kind) => {
    const root = await fixture();
    const prepared = await prepareTestReport(root, "result.json");
    if (kind === "stale") await writeFile(prepared.target, JSON.stringify(report("old-run")));
    if (kind === "malformed") await writeFile(prepared.target, "{}");
    if (kind === "oversized") await writeFile(prepared.target, Buffer.alloc(10_000_001));
    if (kind === "symlink") {
      await writeFile(join(root, "other.json"), JSON.stringify(report(prepared.token)));
      await symlink(join(root, "other.json"), prepared.target);
    }
    await expect(
      collectTestReport({ project: root, ...prepared, runDir: join(root, "run"), claimId: "c1" }),
    ).rejects.toThrow();
  },
);
it("refuses tracked outputs and escaping or linked directories", async () => {
  const root = await fixture();
  await writeFile(join(root, "tracked.json"), "important");
  await commit(root);
  await mkdir(join(root, "directory"));
  await symlink("directory", join(root, "linked"));
  for (const path of [
    "tracked.json",
    "../escape.json",
    ".git/result.json",
    "node_modules/result.json",
    "linked/result.json",
  ])
    await expect(prepareTestReport(root, path)).rejects.toThrow();
  expect(await readFile(join(root, "tracked.json"), "utf8")).toBe("important");
});
it("retains reports and attachments after the shell checkout is removed", async () => {
  const root = await fixture();
  await writeFile(
    join(root, "check.cjs"),
    `const fs = require('node:fs');
fs.writeFileSync('trace.txt', 'retained trace');
const report = ${JSON.stringify(report("placeholder", [{ name: "trace", path: "trace.txt" }]))};
report.run_token = process.env.PRQ_RUN_TOKEN;
fs.writeFileSync(process.env.PRQ_TEST_REPORT, JSON.stringify(report));`,
  );
  await commit(root);
  const results = await shellRunner.run(
    [{ id: "c1", text: "All tests pass.", kind: "command", check: { command: "node check.cjs" } }],
    {
      worktree: root,
      runDir: join(root, "run"),
      appUrl: "",
      timeoutMs: 5000,
      testReports: new Map([["node check.cjs", "results/test.json"]]),
    },
  );
  expect(results.get("c1")?.passed).toBe(true);
  expect(results.get("c1")?.evidence.find((e) => e.type === "command")).toMatchObject({
    test_summary: { passed: 1 },
    path: "evidence/c1/test-report.json",
  });
  expect(await readFile(join(root, "run/evidence/c1/attachment-0"), "utf8")).toBe("retained trace");
  expect(
    (await execa("git", ["worktree", "list", "--porcelain"], { cwd: root })).stdout.match(
      /^worktree /gm,
    ),
  ).toHaveLength(1);
});
it("treats a successful command without its configured report as unavailable", async () => {
  const root = await fixture();
  await writeFile(join(root, "README.md"), "fixture");
  await commit(root);
  const results = await shellRunner.run(
    [{ id: "c1", text: "All tests pass.", kind: "command", check: { command: "node --version" } }],
    {
      worktree: root,
      runDir: join(root, "run"),
      appUrl: "",
      timeoutMs: 5000,
      testReports: new Map([["node --version", "result.json"]]),
    },
  );
  expect(results.get("c1")?.passed).toBeUndefined();
  expect(results.get("c1")?.observed).toContain("missing, malformed");
});
