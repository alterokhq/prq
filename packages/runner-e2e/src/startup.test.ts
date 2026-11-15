import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { E2eReport, e2eRunner } from "./index.js";

const require = createRequire(import.meta.url);

it.each([".", "service"])(
  "starts the real e2e CLI and retains a report for project %s",
  async (selected) => {
    const root = await mkdtemp(join(tmpdir(), "prq-browser-startup-"));
    const project = join(root, selected);
    const server = createServer((_request, response) => response.end("fixture app"));
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing fixture port");
      const appUrl = `http://127.0.0.1:${address.port}`;
      await mkdir(join(project, "node_modules"), { recursive: true });
      await writeFile(join(project, "package.json"), '{"type":"module"}');
      await symlink(
        dirname(dirname(require.resolve("e2e"))),
        join(project, "node_modules/e2e"),
        "junction",
      );
      await writeFile(
        join(project, "e2e.config.mjs"),
        `import {defineEngine} from "e2e/engine";
export default {
  targets: [{engine: defineEngine({
    name: "fixture", version: "1.0.0", spiVersion: 1, platform: "web",
    session: {open: async () => {throw new Error("fixture stops before model use");}}
  }), app: {url: ${JSON.stringify(appUrl)}}}],
  agents: {default: {model: {
    specificationVersion: "v4", provider: "fixture", modelId: "unused", supportedUrls: {},
    doGenerate: async () => {throw new Error("Model calls are forbidden in this startup test");},
    doStream: async () => {throw new Error("Model calls are forbidden in this startup test");}
  }}},
  cache: {mode: "off"}, retries: 0
};`,
      );
      const results = await e2eRunner.run(
        [{ id: "c1", text: "The page works.", kind: "browser" }],
        {
          worktree: root,
          projectDir: project,
          runDir: join(root, ".pr/runs/fixture"),
          appUrl,
          timeoutMs: 5000,
        },
      );
      // The fixture deliberately stops before any model call. Reaching this
      // error proves that config, discovery and subprocess startup succeeded.
      expect(results.get("c1")?.observed).toContain("fixture stops before model use");
      expect(results.get("c1")?.passed).toBeUndefined();
      const output = join(project, ".pr/e2e");
      const runs = await readdir(output);
      expect(runs).toHaveLength(1);
      const report = E2eReport.parse(
        JSON.parse(await readFile(join(output, runs[0] ?? "", "report.json"), "utf8")),
      );
      expect(report.run.results).toHaveLength(1);
      expect(report.run.results[0]?.titlePath.at(-1)).toBe("c1: The page works.");
      expect(
        (await readdir(join(project, "tests"))).filter((file) => file.endsWith(".e2e.ts")),
      ).toEqual([]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  },
  40000,
);
