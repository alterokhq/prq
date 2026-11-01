import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Store } from "@prq/core";

export class FsStore implements Store {
  constructor(private base: string) {}
  root(runId: string) {
    return join(this.base, "runs", runId);
  }
  async put(runId: string, relPath: string, bytes: Uint8Array | string) {
    const p = join(this.root(runId), relPath);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes);
    return p;
  }
  async get(runId: string, relPath: string) {
    return new Uint8Array(await readFile(join(this.root(runId), relPath)));
  }
  async list(runId: string) {
    const walk = async (d: string): Promise<string[]> => {
      const out: string[] = [];
      for (const e of await readdir(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        out.push(...(e.isDirectory() ? await walk(p) : [p]));
      }
      return out;
    };
    return walk(this.root(runId));
  }
}
