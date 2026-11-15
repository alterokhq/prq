import assert from "node:assert/strict";
import { test } from "node:test";
import { boundedProcess } from "./portable-process.mjs";

test("bounded execution terminates an unresponsive command", { timeout: 10_000 }, async () => {
  const result = await boundedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    cwd: process.cwd(),
    env: { PATH: process.env.PATH },
    timeout: 100,
  });
  assert.equal(result.error, true);
  assert.notEqual(result.status, 0);
});
