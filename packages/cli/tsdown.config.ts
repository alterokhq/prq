import { defineConfig } from "tsdown";
export default defineConfig({
  entry: ["src/index.ts", "src/vitest.ts", "src/playwright.ts"],
  format: "esm",
  noExternal: [/^@prq\//],
});
