import { openai } from "@ai-sdk/openai";
import { web } from "@e2e-dev/web";

export default {
  targets: [{ engine: web({ browser: "chromium" }), app: { url: process.env.PRQ_APP_URL ?? "http://127.0.0.1:4317" } }],
  agents: { default: { model: openai("gpt-6.1-sol"), judgmentTimeout: 60_000 } },
  reporters: ["list", "markdown"],
  retries: 0,
  cache: { mode: "read-write", dir: ".e2e/cache" },
};
