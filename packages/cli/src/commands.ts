import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { ProjectIssue } from "./project.js";
export async function verificationCommands(root: string, repository = root): Promise<string[]> {
  let config: string | undefined;
  try {
    config = await readFile(join(root, "prq.config.json"), "utf8");
  } catch (issue) {
    if (!(issue instanceof Error && "code" in issue && issue.code === "ENOENT")) throw issue;
  }
  if (config !== undefined) {
    try {
      return z
        .object({ commands: z.array(z.string().trim().min(1).max(4000)).max(100) })
        .strict()
        .parse(JSON.parse(config)).commands;
    } catch {
      throw new ProjectIssue(
        "Invalid prq.config.json: supply a commands array of explicit verification commands.",
      );
    }
  }
  try {
    const pkg = z
      .object({
        packageManager: z.string().optional(),
        scripts: z.record(z.string(), z.string()).optional(),
      })
      .parse(JSON.parse(await readFile(join(root, "package.json"), "utf8")));
    let packageManager = pkg.packageManager;
    let parent = root;
    while (!packageManager && parent !== repository && dirname(parent) !== parent) {
      parent = dirname(parent);
      try {
        packageManager = z
          .object({ packageManager: z.string().optional() })
          .parse(JSON.parse(await readFile(join(parent, "package.json"), "utf8"))).packageManager;
      } catch {
        /* A non-JavaScript parent needs no manifest. */
      }
    }
    const manager = packageManager?.split("@")[0] ?? "npm";
    const executable = ["pnpm", "npm", "yarn", "bun"].includes(manager) ? manager : "npm";
    return Object.keys(pkg.scripts ?? {})
      .filter((name) =>
        /^(?:test(?::[a-zA-Z0-9_-]+)*|lint(?::[a-zA-Z0-9_-]+)*|typecheck|check|build)$/.test(name),
      )
      .map((name) => `${executable} run ${name}`);
  } catch {
    return [];
  }
}
export function isVerificationCommand(
  command: string | undefined,
  available: readonly string[],
): boolean {
  return command !== undefined && available.includes(command);
}
