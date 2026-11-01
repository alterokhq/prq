/** Numeric observations from recognized test reporter summaries. Raw log lines never leave the artifact. */
export interface TestCount {
  format: "tap" | "node_test" | "vitest" | "jest" | "plain";
  metric: "total" | "passed" | "failed" | "skipped" | "todo" | "executed" | "cancelled";
  count: number;
}
const labels = {
  tests: "total",
  pass: "passed",
  fail: "failed",
  skipped: "skipped",
  todo: "todo",
  cancelled: "cancelled",
  passed: "passed",
  failed: "failed",
  total: "total",
} satisfies Record<string, TestCount["metric"]>;
function metric(label: string): TestCount["metric"] | undefined {
  switch (label) {
    case "tests":
      return labels.tests;
    case "pass":
    case "passed":
      return labels.pass;
    case "fail":
    case "failed":
      return labels.fail;
    case "skipped":
      return labels.skipped;
    case "todo":
      return labels.todo;
    case "cancelled":
      return labels.cancelled;
    case "total":
      return labels.total;
    default:
      return undefined;
  }
}
export function testCounts(stdout = "", stderr = ""): TestCount[] {
  const counts: TestCount[] = [];
  const add = (format: TestCount["format"], label: TestCount["metric"], raw: string) => {
    const count = Number(raw);
    if (Number.isSafeInteger(count) && count >= 0) counts.push({ format, metric: label, count });
  };
  for (const raw of `${stdout.slice(-16_000)}\n${stderr.slice(-16_000)}`
    .split(/\r?\n/)
    .slice(-512)) {
    // Only presentation escapes are removed; source lines are never forwarded or summarized.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI color escape sequences are presentation, not report content.
    const line = raw.replace(/\x1b\[[0-9;]*m/g, "").trim();
    if (line.length > 1000) continue;
    const numbered = /^(#|ℹ)\s+(tests|pass|fail|skipped|todo|cancelled)\s+(\d+)\s*$/.exec(line);
    if (numbered) {
      const name = numbered[2];
      const value = numbered[3];
      const key = name ? metric(name) : undefined;
      if (key && value) add(numbered[1] === "#" ? "tap" : "node_test", key, value);
      continue;
    }
    const reporter = /^Tests(:|\s)\s*(.+)$/.exec(line);
    if (reporter?.[2]) {
      const body = reporter[2];
      // Reject the whole line unless every segment is a count or a parenthesized total.
      if (
        !/^(?:\d+ (?:passed|failed|skipped|todo|total)(?:\s*[,|]\s*|\s+|$))+(?:\(\d+\))?$/.test(
          body,
        )
      )
        continue;
      const format = reporter[1] === ":" ? "jest" : "vitest";
      for (const item of body.matchAll(/(\d+) (passed|failed|skipped|todo|total)/g)) {
        const name = item[2];
        const value = item[1];
        const key = name ? metric(name) : undefined;
        if (key && value) add(format, key, value);
      }
      const total = /\((\d+)\)$/.exec(body)?.[1];
      if (total) add(format, "total", total);
      continue;
    }
    const plain = /^(\d+) tests? (?:run|ran|executed),?\s+(\d+) skipped[.!]?$/.exec(line);
    if (plain?.[1] && plain[2]) {
      add("plain", "executed", plain[1]);
      add("plain", "skipped", plain[2]);
    }
  }
  return counts.slice(-24);
}
/** Exit status alone supports only narrowly stated completion/status claims. */
export function isExitStatusClaim(text: string): boolean {
  return (
    /^(?:(?:all|the)\s+)?(?:production\s+)?(?:tests?|test suite|checks?|build|lint|typecheck|type check)\s+(?:pass(?:es|ed)?|succeed(?:s|ed)?|complete(?:s|d)?(?:\s+(?:successfully|cleanly))?)[.!]?$/i.test(
      text.trim(),
    ) ||
    /^(?:there are\s+)?no\s+(?:lint|typescript|typecheck|type-check)\s+(?:errors|issues)[.!]?$/i.test(
      text.trim(),
    ) ||
    /^(?:the\s+)?command\s+exit(?:s|ed)?\s+(?:with\s+(?:code|status)\s+)?(?:0|zero)[.!]?$/i.test(
      text.trim(),
    )
  );
}

/** The CLI offers script commands; inline programs remain only in the saved raw evidence. */
export function commandLabel(command: string | undefined): string {
  return command && /^(?:npm|pnpm|yarn|bun) (?:run )?[A-Za-z0-9:_-]+$/.test(command)
    ? command
    : "command recorded in artifact";
}
