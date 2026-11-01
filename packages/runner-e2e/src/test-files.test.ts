import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { DraftClaim } from "@prq/core";
import { afterEach, expect, it } from "vitest";
import { planTestFiles, withTestFiles } from "./test-files.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "prq-test-files-"));
  roots.push(root);
  const claims: DraftClaim[] = [
    { id: "c1", text: 'Exact "claim" one.', kind: "browser" },
    { id: "c2", text: "Claim two.", kind: "browser", check: { setup: "Type a query" } },
  ];
  return { root, claims, files: planTestFiles(claims, root, "tests/prq-lock.e2e.ts") };
}

it("creates stable independent claim files and removes only owned files", async () => {
  const { root, claims, files } = await fixture();
  const unrelated = join(root, "tests/unrelated.e2e.ts");
  await mkdir(dirname(unrelated), { recursive: true });
  await writeFile(unrelated, "user test");
  expect(planTestFiles([...claims].reverse(), root, "tests/prq-lock.e2e.ts").reverse()).toEqual(
    files,
  );
  await withTestFiles(files, async () => {
    expect(new Set(files.map((file) => file.path)).size).toBe(2);
    for (const [index, file] of files.entries()) {
      const source = await readFile(file.path, "utf8");
      expect(source).toContain(`await agent.assert(${JSON.stringify(claims[index]?.text)}`);
      expect(source.match(/\btest\(/g)).toHaveLength(1);
    }
    expect(files.map((file) => file.relativePath)).not.toContain("tests/unrelated.e2e.ts");
  });
  for (const file of files) await expect(access(file.path)).rejects.toThrow();
  expect(await readFile(unrelated, "utf8")).toBe("user test");
});

it("cleans earlier files after a later collision without overwriting the existing file", async () => {
  const { files } = await fixture();
  const collision = files[1];
  const first = files[0];
  if (!collision || !first) throw new Error("Missing fixture files");
  await mkdir(dirname(collision.path), { recursive: true });
  await writeFile(collision.path, "existing user content");
  let ran = false;
  await expect(
    withTestFiles(files, async () => {
      ran = true;
    }),
  ).rejects.toThrow();
  expect(ran).toBe(false);
  await expect(access(first.path)).rejects.toThrow();
  expect(await readFile(collision.path, "utf8")).toBe("existing user content");
});

it("cleans every owned file when execution fails", async () => {
  const { files } = await fixture();
  await expect(
    withTestFiles(files, async () => {
      throw new Error("runner stopped");
    }),
  ).rejects.toThrow("runner stopped");
  for (const file of files) await expect(access(file.path)).rejects.toThrow();
});

it("rejects escaping paths and duplicate claim IDs before writing", async () => {
  const { root, claims } = await fixture();
  expect(() => planTestFiles(claims, root, "../escaped.e2e.ts")).toThrow("inside");
  expect(() => planTestFiles([...claims, ...claims], root)).toThrow("Duplicate");
});
