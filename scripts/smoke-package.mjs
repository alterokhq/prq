import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const directory = await mkdtemp(join(tmpdir(), "prq-package-"));
const run = (command, args, cwd) =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, CI: "true" },
  });
try {
  const [packed] = JSON.parse(
    run("npm", ["pack", "--json", "--pack-destination", directory], join(root, "packages/cli")),
  );
  assert.deepEqual(packed.files.map((file) => file.path).sort(), [
    "LICENSE",
    "README.md",
    "dist/index.js",
    "package.json",
  ]);
  run(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", join(directory, packed.filename)],
    directory,
  );
  const installed = join(directory, "node_modules/@alterok/prq");
  const manifest = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
  assert.equal(manifest.name, "@alterok/prq");
  assert.ok(
    Object.values(manifest.dependencies).every((version) => !version.startsWith("workspace:")),
  );
  const cli = join(installed, manifest.bin.prq);
  assert.equal(run(process.execPath, [cli, "--version"], directory).trim(), manifest.version);
  const help = run(process.execPath, [cli, "--help"], directory);
  assert.ok(help.includes("--claims"));
  assert.ok(help.includes("--json"));
  // 0.2 adds no-key inspection; this check also works before that feature merges.
  if (help.includes("show [options]")) {
    const report = JSON.parse(
      run(
        process.execPath,
        [cli, "show", join(root, "fixtures/example.json"), "--json"],
        directory,
      ),
    );
    assert.equal(report.claims.length, 6);
  }
  console.log("Packed CLI installs and runs outside the workspace without provider credentials.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
