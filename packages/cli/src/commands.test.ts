import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { isVerificationCommand, verificationCommands } from "./commands.js";

it("offers verification scripts and requires an exact command match", async () => {
  const root = await mkdtemp(join(tmpdir(), "prq-commands-"));
  try {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        packageManager: "pnpm@11",
        scripts: {
          test: "vitest run",
          "test:unit": "vitest run",
          lint: "biome check .",
          build: "tsc",
          deploy: "deploy",
          migrate: "migrate",
          dev: "dev",
          delete: "delete",
        },
      }),
    );
    const commands = await verificationCommands(root);
    expect(commands).toEqual([
      "pnpm run test",
      "pnpm run test:unit",
      "pnpm run lint",
      "pnpm run build",
    ]);
    expect(isVerificationCommand("pnpm run test; rm -rf .", commands)).toBe(false);
    expect(isVerificationCommand("pnpm run deploy", commands)).toBe(false);
    expect(isVerificationCommand("pnpm run test", commands)).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
