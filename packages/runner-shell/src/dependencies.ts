import { constants, existsSync } from "node:fs";
import { cp, lstat, readdir, readlink, rm, symlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { execa } from "execa";

function inside(root: string, target: string) {
  const path = relative(root, target);
  if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path))
    throw new Error("Dependencies outside the repository cannot be copied safely.");
  return path;
}

async function rebaseLinks(
  source: string,
  destination: string,
  root: string,
  checkout: string,
): Promise<void> {
  const info = await lstat(destination);
  if (info.isSymbolicLink()) {
    const target = resolve(dirname(source), await readlink(source));
    const localTarget = join(checkout, inside(root, target));
    await rm(destination);
    await symlink(relative(dirname(destination), localTarget), destination);
  } else if (info.isDirectory()) {
    for (const item of await readdir(destination))
      await rebaseLinks(join(source, item), join(destination, item), root, checkout);
  }
}

/** Copy root and workspace dependencies, keeping workspace links in the disposable checkout. */
export async function copyDependencies(root: string, checkout: string, project: string) {
  const files = await execa("git", ["ls-files", "-z", "--", "package.json", "**/package.json"], {
    cwd: checkout,
    maxBuffer: 2 * 1024 * 1024,
  });
  const directories = new Set(
    ["", project, ...files.stdout.split("\0").filter(Boolean).map(dirname)].map((path) =>
      path === "." ? "" : path,
    ),
  );
  if (directories.size > 1000) throw new Error("Too many workspace dependency directories.");
  for (const directory of directories) {
    const source = join(root, directory, "node_modules");
    const destination = join(checkout, directory, "node_modules");
    if (!existsSync(source)) continue;
    await cp(source, destination, {
      recursive: true,
      verbatimSymlinks: true,
      mode: constants.COPYFILE_FICLONE,
    });
    await rebaseLinks(source, destination, root, checkout);
  }
}
