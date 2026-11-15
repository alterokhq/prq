import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { portableRun } from "./portable-run.mjs";

try {
  const input = (name) => process.env[`INPUT_${name.toUpperCase()}`];
  if (process.env.GITHUB_EVENT_NAME === "pull_request_target")
    throw new Error(
      "Run verification on pull_request or a separately approved workflow, not pull_request_target.",
    );
  if (process.env.GITHUB_EVENT_NAME === "pull_request") {
    const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
    if (event.pull_request?.head?.sha !== input("head"))
      throw new Error(
        "The selected commit must be this pull request's head, not its synthetic merge commit.",
      );
  }
  const cwd = resolve(process.env.GITHUB_WORKSPACE ?? ".", input("working-directory") ?? ".");
  const outcome = await portableRun({
    cli: resolve(cwd, input("cli")),
    cwd,
    report: resolve(cwd, input("report")),
    expectedHead: input("head"),
    location: "ci",
    executor: "github_actions",
  });
  if (process.env.GITHUB_OUTPUT) {
    for (const [key, value] of Object.entries({
      "exit-code": outcome.exit_code,
      report: outcome.report ?? "",
      "evidence-directory": outcome.evidence_directory,
      "execution-directory": outcome.output_directory,
    })) {
      if (/[\r\n]/.test(String(value))) throw new Error("Invalid output path.");
      await appendFile(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
    }
  }
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
  process.exitCode = outcome.exit_code;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "PRQ unavailable."}\n`);
  process.exitCode = 2;
}
