import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { summarizeTests, TestReport, type TestSummary } from "@prq/core";
import { execa } from "execa";

function inside(root: string, path: string) {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export async function prepareTestReport(project: string, path: string) {
  project = await realpath(project);
  if (
    !path.endsWith(".json") ||
    path.split(/[\\/]/).some((p) => ["..", ".git", "node_modules"].includes(p)) ||
    isAbsolute(path) ||
    path.includes(":")
  )
    throw new Error(
      "Use a repository-local JSON report path outside dependencies and Git metadata.",
    );
  const target = resolve(project, path);
  if (!inside(project, target)) throw new Error("Report path outside project");
  let directory = project;
  for (const part of relative(project, dirname(target)).split(sep).filter(Boolean)) {
    directory = join(directory, part);
    await mkdir(directory, { recursive: true });
    if ((await lstat(directory)).isSymbolicLink() || !inside(project, await realpath(directory)))
      throw new Error("Report directory is a symlink");
  }
  const tracked = await execa("git", ["ls-files", "--error-unmatch", "--", path], {
    cwd: project,
    reject: false,
  });
  if (tracked.exitCode === 0) throw new Error("Report output must not overwrite a committed file");
  await rm(target, { force: true });
  return { target, token: randomUUID() };
}

async function readBounded(path: string, maxBytes: number) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error("Artifact is absent or too large");
    const bytes = Buffer.alloc(stat.size + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== stat.size) throw new Error("Artifact changed during collection");
    return bytes.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

export async function collectTestReport(options: {
  project: string;
  target: string;
  token: string;
  runDir: string;
  claimId: string;
}): Promise<{ summary: TestSummary; path: string; notes: string[] }> {
  const { target, token, runDir, claimId } = options;
  const project = await realpath(options.project);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(claimId)) throw new Error("Invalid claim ID");
  if (!inside(project, await realpath(target))) throw new Error("Report escaped the project");
  const bytes = await readBounded(target, 10_000_000);
  const report = TestReport.parse(JSON.parse(bytes.toString("utf8")));
  if (report.run_token !== token) throw new Error("Report does not belong to this execution");
  const dir = join(runDir, "evidence", claimId);
  await mkdir(dir, { recursive: true });
  const notes: string[] = [];
  let copied = 0;
  for (const test of report.tests) {
    for (const attachment of test.attachments) {
      const original = attachment.path;
      try {
        if (copied >= 20) throw new Error("Attachment limit");
        const source = resolve(project, original);
        if (!inside(project, await realpath(source))) throw new Error("Attachment outside project");
        const data = await readBounded(source, 5_000_000);
        const file = `attachment-${copied++}`;
        await writeFile(join(dir, file), data);
        attachment.path = file;
      } catch {
        attachment.path = "unavailable";
        notes.push(
          "A test attachment was unavailable, outside the project, or exceeded the collection limit.",
        );
      }
    }
  }
  await writeFile(join(dir, "test-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return {
    summary: summarizeTests(report),
    path: `evidence/${claimId}/test-report.json`,
    notes: [...new Set(notes)],
  };
}
