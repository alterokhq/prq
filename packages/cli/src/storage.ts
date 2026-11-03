import { constants } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ProofRequest } from "@prq/core";
export async function readProof(path: string): Promise<ProofRequest> {
  return ProofRequest.parse(JSON.parse(await readFile(path, "utf8")));
}
async function atomic(path: string, text: string) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, text);
  await rename(temporary, path);
}
export async function saveProof(root: string, pr: ProofRequest): Promise<string> {
  const runDir = join(root, ".pr", "runs", pr.id);
  await mkdir(runDir, { recursive: true });
  const json = `${JSON.stringify(pr, null, 2)}\n`;
  // Preserve historical renderings, but stop presenting them as the current report.
  for (const [name, archived] of [
    ["index.html", "index.pre-0.2.html"],
    ["card.html", "card.pre-0.2.html"],
    ["summary.md", "summary.pre-0.2.md"],
  ]) {
    if (!name || !archived) continue;
    try {
      await copyFile(join(runDir, name), join(runDir, archived), constants.COPYFILE_EXCL);
      await rm(join(runDir, name));
    } catch (issue) {
      if (!(issue instanceof Error && "code" in issue && issue.code === "ENOENT")) throw issue;
    }
  }
  await atomic(join(runDir, "proof-request.json"), json);
  await atomic(join(root, ".pr", "last.json"), json);
  return join(runDir, "proof-request.json");
}
