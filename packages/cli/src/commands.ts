import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
export async function verificationCommands(root: string): Promise<string[]> {
  try {
    const pkg = z
      .object({
        packageManager: z.string().optional(),
        scripts: z.record(z.string(), z.string()).optional(),
      })
      .parse(JSON.parse(await readFile(join(root, "package.json"), "utf8")));
    const manager = pkg.packageManager?.split("@")[0] ?? "npm";
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
