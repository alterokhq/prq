import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ProofRequest } from "@prq/core";
import { renderCard, renderMarkdown, renderPage } from "@prq/render";
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
  await atomic(join(runDir, "proof-request.json"), json);
  await atomic(join(runDir, "index.html"), renderPage(pr));
  await atomic(join(runDir, "card.html"), renderCard(pr));
  await atomic(join(runDir, "summary.md"), renderMarkdown(pr));
  await atomic(join(root, ".pr", "last.json"), json);
  return join(runDir, "index.html");
}
