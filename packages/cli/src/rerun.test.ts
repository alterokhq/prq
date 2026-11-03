import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { lockClaims, type ProofRequest } from "@prq/core";
import { expect, it } from "vitest";

it("reruns locked human claims with inherited JSON flags and a unique report", async () => {
  const root = await mkdtemp(join(tmpdir(), "prq-cli-rerun-"));
  try {
    const git = (args: string[]) => {
      const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
      if (result.status !== 0) throw new Error(result.stderr);
    };
    git(["init"]);
    git([
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "--allow-empty",
      "-m",
      "Create fixture",
    ]);
    const claims: ProofRequest["claims"] = [
      { id: "c1", text: "The helper is readable.", kind: "human", verdict: "needs_human" },
    ];
    const proof: ProofRequest = {
      version: "0.1",
      id: "original",
      created_at: new Date().toISOString(),
      subject: { head: "HEAD" },
      source: { kind: "file", text: claims[0]?.text ?? "", hash: lockClaims(claims) },
      claims,
      summary: { held: 0, broken: 0, needs_human: 1, unverified: 0 },
    };
    await mkdir(join(root, ".pr"));
    await writeFile(join(root, ".pr", "last.json"), JSON.stringify(proof));
    const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
    const result = spawnSync(process.execPath, [cli, "rerun", "--json", "--quiet", "--no-open"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, OPENAI_API_KEY: "fixture-only-unused" },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).summary.needs_human).toBe(1);
    expect(JSON.parse(result.stdout).claims).toHaveLength(1);
    expect(JSON.parse(result.stdout).claims[0].text).toBe(claims[0]?.text);
    expect(JSON.parse(result.stdout).source.hash).toBe(proof.source.hash);
    const next = JSON.parse(await readFile(join(root, ".pr", "last.json"), "utf8"));
    expect(next.id).not.toBe(proof.id);
    expect(next.source.hash).toBe(proof.source.hash);
    expect(next.claims[0].text).toBe(claims[0]?.text);
    expect(next.version).toBe("0.2");
    expect(next.configuration.provider).toBe("openai");
    const files = await readdir(join(root, ".pr", "runs", next.id));
    expect(files.sort()).toEqual(["claims.lock.json", "proof-request.json"]);
    const shown = spawnSync(process.execPath, [cli, "show", "--json"], {
      cwd: root,
      encoding: "utf8",
      env: { PATH: process.env.PATH },
    });
    expect(shown.status).toBe(0);
    expect(JSON.parse(shown.stdout).claims).toEqual(next.claims);
    expect(await realpath(JSON.parse(shown.stdout).report)).toBe(
      await realpath(join(root, ".pr", "runs", next.id, "proof-request.json")),
    );
    const missingKey = spawnSync(
      process.execPath,
      [cli, "rerun", "--json", "--provider", "openrouter", "--model", "fixture/model"],
      {
        cwd: root,
        encoding: "utf8",
        env: { PATH: process.env.PATH },
      },
    );
    expect(missingKey.status).toBe(2);
    expect(missingKey.stderr).toBe("");
    expect(JSON.parse(missingKey.stdout)).toMatchObject({
      format: "prq-error/v1",
      status: "unverified",
    });
    expect(JSON.parse(missingKey.stdout).reason).toContain("OPENROUTER_API_KEY");
    expect(JSON.parse(await readFile(join(root, ".pr", "last.json"), "utf8")).id).toBe(next.id);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each(["open", "render"])(
  "guides users of removed %s to show with an unavailable exit code",
  (name) => {
    const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
    const result = spawnSync(process.execPath, [cli, name, "old.json", "--json"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH },
    });
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      format: "prq-error/v1",
      status: "unverified",
    });
    expect(JSON.parse(result.stdout).reason).toContain("prq show");
  },
);
