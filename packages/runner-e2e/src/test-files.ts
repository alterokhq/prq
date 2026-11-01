import { createHash } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { DraftClaim } from "@prq/core";

export function generateTestFile(claims: DraftClaim[]): string {
  return `import { test } from "e2e";\n\n${claims
    .map((claim) => {
      const setup = claim.check?.setup
        ? `  await app.screenshot("before-setup");\n  await agent.act(${JSON.stringify(`${claim.check.setup} This is setup only: complete this step once the requested actions are performed, regardless of the resulting application behavior. The following assertion will check correctness.`)});\n`
        : "";
      return `test(${JSON.stringify(`${claim.id}: ${claim.text}`)}, async ({ app, agent }) => {\n  await app.open(${JSON.stringify(claim.check?.path ?? "/")});\n  await agent.waitFor("The page has finished its initial loading state.");\n${setup}  await agent.assert(${JSON.stringify(claim.text)}, { vision: true });\n});`;
    })
    .join("\n\n")}\n`;
}

export function planTestFiles(claims: DraftClaim[], worktree: string, testFile?: string) {
  const hash = createHash("sha256").update(generateTestFile(claims)).digest("hex").slice(0, 20);
  const base = resolve(worktree, testFile ?? `tests/prq-generated-${hash}.e2e.ts`);
  const seen = new Set<string>();
  return claims.map((claim) => {
    if (seen.has(claim.id)) throw new Error("Duplicate browser claim ID");
    seen.add(claim.id);
    const id = createHash("sha256").update(claim.id).digest("hex").slice(0, 20);
    const path = `${base.replace(/\.e2e\.[cm]?[jt]s$/, "")}-${id}.e2e.ts`;
    const relativePath = relative(worktree, path).split(sep).join("/");
    if (isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith("../"))
      throw new Error("The generated tests must be inside the target project");
    return { claimId: claim.id, path, relativePath, source: generateTestFile([claim]) };
  });
}

/** Only files this invocation created are removed, including after a partial write. */
export async function withTestFiles<T>(
  files: ReturnType<typeof planTestFiles>,
  run: () => Promise<T>,
): Promise<T> {
  const owned: string[] = [];
  try {
    for (const file of files) {
      await mkdir(dirname(file.path), { recursive: true });
      const handle = await open(file.path, "wx");
      owned.push(file.path);
      try {
        await handle.writeFile(file.source);
      } finally {
        await handle.close();
      }
    }
    return await run();
  } finally {
    await Promise.all(owned.map((path) => rm(path, { force: true })));
  }
}
