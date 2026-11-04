import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { execa } from "execa";

export class ProjectIssue extends Error {}

/** Explicit paths are repository-relative; no option means the invocation directory. */
export async function selectProject(root: string, selection?: string) {
  const repository = await realpath(root);
  let directory: string;
  try {
    directory = await realpath(
      selection === undefined ? process.cwd() : resolve(repository, selection),
    );
    if (!(await stat(directory)).isDirectory()) throw new Error();
  } catch {
    throw new ProjectIssue(
      "Choose an existing project directory with --project <repo-relative-directory>.",
    );
  }
  const path = relative(repository, directory);
  if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path))
    throw new ProjectIssue("The project must be inside the current repository.");
  const git = await execa("git", ["rev-parse", "--show-toplevel"], {
    cwd: directory,
    reject: false,
  });
  if (git.exitCode !== 0 || (await realpath(git.stdout.trim())) !== repository)
    throw new ProjectIssue("Select a directory in this repository, not a nested repository.");
  return { directory, path: path.split(sep).join("/") || "." };
}
