# Structured test evidence

A test command can exit 0 after running no tests, skipping tests or retrying failures. PRQ needs a fresh structured report before it can hold a test-suite claim such as “All tests pass.” The judge cannot override missing or incomplete execution.

This changes earlier command verification: console counts and exit 0 alone no longer support test-suite claims. Existing string command entries still execute, but suite claims remain **unverified** until a reporter is configured. Narrow claims such as “Build passes”, “Lint passes” and “The command exits 0” still use exit status. Keep the original locked claim when repairing a run; do not rewrite a test claim as an exit-code claim to clear the gate.

## Vitest and Playwright

Install `@alterok/prq` in the project as a development dependency. Add one or both commands to that project's `prq.config.json`:

```json
{
  "commands": [
    "pnpm run lint",
    {
      "command": "pnpm exec vitest run --reporter=@alterok/prq/vitest",
      "report": ".prq-results/unit.json"
    },
    {
      "command": "pnpm exec playwright test --reporter=@alterok/prq/playwright",
      "report": ".prq-results/browser.json"
    }
  ]
}
```

The commands replace automatic script discovery. A handoff's `check.command` must match an entry exactly. Use the package manager installed in your project. Commit the config and source before verification; the command runner checks the captured commit. Add `.prq-results/` to `.gitignore` if you also run reporters directly.

PRQ supplies `PRQ_TEST_REPORT` and a unique `PRQ_RUN_TOKEN`, collects the report, then removes the disposable checkout. The report path must be an untracked `.json` file inside the selected project, outside `.git` and `node_modules`, without symlink directories. Missing, stale, malformed or oversized reports leave the claim unverified.

These adapters are tested against **Vitest 5.0.5** and **Playwright Test 1.64.1**. Vitest uses lifecycle diagnostics and task hook states to distinguish assertions from unfinished setup hooks. Compatibility with other versions is not established. The package does not install or bundle either test framework. Our adapter tests run real test runners with passing, failing, skipped, retry and setup cases; the Playwright adapter tests do not launch a browser.

To inspect a reporter directly, outside PRQ:

```sh
PRQ_TEST_REPORT=.prq-results/unit.json pnpm exec vitest run --reporter=@alterok/prq/vitest
```

That report has the token `standalone`; PRQ will not reuse it for verification. CLI reporter flags replace the framework's configured reporters. If you need other reporters alongside PRQ, use the framework's reporter configuration and allowlist the corresponding command. See [Vitest reporters](https://vitest.dev/guide/reporters) and [Playwright reporters](https://playwright.dev/docs/test-reporters).

## Verdict rules

| Recorded evidence for a passing-suite claim | Outcome |
| --- | --- |
| At least one completed test, all passing, command exits 0, no skips/retries/errors | Eligible for independent judgment; not automatically held |
| A failed test-body assertion | Broken, even if a model would be optimistic or the command exits 0 |
| No completed tests, missing counts or missing report | Unverified |
| Skipped, todo, flaky, expected-failure or unknown tests | Unverified unless another test records an actual failed assertion |
| Timeout, cancellation, setup/runtime error or incomplete run | Unverified unless a completed test assertion already contradicts the claim |

A report preserves individual outcomes and attempt counts. A test that passes after a retry is flaky, not a clean pass. Expected failures do not count as all tests passing. Generic thrown errors and failed setup/teardown hooks do not establish a product assertion failure. Assertion libraries that neither adapter recognizes are conservatively recorded as errors.

Suite counts establish only the suite outcome. “Login works” cannot be held from a passing suite's counts; it needs a relevant independent behavioral check. PRQ does not establish whether the builder omitted requirements or wrote sufficient tests. Commands remain trusted executable repository code, and a run token prevents accidental stale reuse, not forged evidence from a malicious command. Keep CI and review enabled.

## Other frameworks and runners

Any allowlisted command can emit the same report using the environment variables above. No JavaScript runtime or PRQ dependency is required in the emitter:

```json
{
  "format": "prq-test-results/v1",
  "framework": "my-runner",
  "run_token": "copy PRQ_RUN_TOKEN here",
  "complete": true,
  "errors": 0,
  "tests": [
    {
      "name": "rejects an invalid value",
      "status": "passed",
      "attempts": 1,
      "attachments": []
    }
  ]
}
```

`framework` is a lowercase identifier of up to 100 letters, digits, dots, underscores or hyphens, beginning with a letter or digit. `errors` counts collection, setup or other errors outside individual tests. `complete` means the runner finished its intended execution. List every collected test, including skipped and unfinished tests. Statuses are `passed`, `failed` (a completed assertion contradicted its expectation), `skipped`, `todo`, `flaky`, `interrupted`, `error`, `unknown` and `expected_failed`. Completed outcomes require at least one attempt; do not label retried tests `passed`. Preserve unknown information as unknown, never as a zero count or a success.

The runtime contract is [test-results.ts](../packages/core/src/test-results.ts). Adapters for other frameworks are not built yet; plain pytest/Go/JUnit output is not parsed into this contract automatically. Execution can be wrapped by another runner, but remote/container output must be copied back to `PRQ_TEST_REPORT` and retain the supplied token. No Dagger integration is included.

## Artifacts and privacy

The full report is stored at `evidence/<claim-id>/test-report.json` inside the PRQ run. Command evidence contains its path and a numeric `test_summary`, also available through `prq show --json`. `total` includes all test rows; `executed` counts passed, failed, flaky and expected-failure outcomes. `error` counts test rows with runtime/setup errors; `errors` counts errors outside tests.

The report is limited to 10 MB and 100,000 test rows. An attachment is `{ "name": "trace", "path": "relative/or/absolute/file" }`. PRQ copies up to 20 files of at most 5 MB each from inside the selected project. External, symlink-file, missing and oversized attachments are marked unavailable with a diagnostic. Saved attachment paths are relative to the saved test report. Playwright path-backed attachments are collected; inline attachment bodies and Vitest artifacts are not currently exported. Reports and captured output remain available after checkout cleanup.

Only numeric summary fields and a sanitized command label go to the judge, not test names, attachment contents, raw command output or source code. Framework labels in summaries are adapter metadata. Inspect local artifacts before sharing them.
