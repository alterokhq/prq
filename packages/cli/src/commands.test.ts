import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { isVerificationCommand, verificationCommands, verificationSetup } from "./commands.js";

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

it("loads structured reports alongside plain commands and rejects duplicate entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "prq-commands-"));
  try {
    const config = {
      commands: ["pnpm run lint", { command: "pnpm run test", report: ".prq-results/unit.json" }],
    };
    await writeFile(join(root, "prq.config.json"), JSON.stringify(config));
    const setup = await verificationSetup(root);
    expect(setup.commands).toEqual(["pnpm run lint", "pnpm run test"]);
    expect(setup.testReports.get("pnpm run test")).toBe(".prq-results/unit.json");
    await writeFile(
      join(root, "prq.config.json"),
      JSON.stringify({ commands: [...config.commands, "pnpm run test"] }),
    );
    await expect(verificationSetup(root)).rejects.toThrow("unique command");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
