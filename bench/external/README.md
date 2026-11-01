# External repository checks

This is a small seeded cross-repository validation of prq. It does not estimate accuracy across repositories, frameworks, or real bug reports. The two claims were chosen by the benchmark author; the defects are deliberate. Existing upstream tests remain untouched.

The command target is https://github.com/lukeed/clsx at `925494cf31bcd97d3337aacd34e659e80cae7fe2`. The browser target is the Backbone example in https://github.com/tastejs/todomvc at `ff43b02e59dfa604386bb382034b2cd07c2bcd8a`. Both are MIT licensed. Each evidence folder contains the upstream license. No public demo was used or modified.

`locks/` preserves the exact npm dependency resolutions used in these runs. `manifest.json` records the pinned commits and exact single-location mutations. `claims/` contains the unchanged input sentences. Each pair first runs an independent deterministic oracle, then prq. The mutated state uses `prq rerun`, preserving the original claim lock and check. Result files record the oracle exit code, actual prq verdict, elapsed time, tool hash, models, tested commit and verbatim-source check. Unknown costs remain `null`.

## Results and limits

| Target | Original | Seeded defect | prq time, original / defect |
| --- | --- | --- | --- |
| clsx | held | broken | 5.35s / 1.21s |
| TodoMVC Backbone | held | broken | 18.60s / 25.54s |

The four primary rows are in `results.json`. Earlier setup attempts are listed separately and retained.

The clsx baseline ran all 32 original tests and returned `held`. Replacing the exported function's return value with an empty string broke 25 original tests; prq returned `broken`. Its test files and package scripts were unchanged. The claimed behavior is only that the existing suite completes without failing tests; this is not a claim that clsx has no bugs.

The clsx suite's legacy `esm` loader cannot run under this machine's Node 24.11.0 or Node 22.23.2. The captured Node 24 result is in `evidence/clsx/node24-upstream-test-runtime.json`. We ran those original tests under Node 18.20.8 while prq itself used Node 24.11.0. npm 11.6.1 printed an unsupported-Node warning, preserved in the evidence, but did execute the full suite. The explicit test runtime is part of the reproduction requirements. A separate initial baseline proof is preserved alongside the paired run.

The TodoMVC target serves the upstream committed `examples/backbone/dist` files directly. The mutation removes its todo creation call from `dist/views/app-view.js`. This tests the served JavaScript artifact; it does not test the upstream build step. Its deterministic oracle uses a fresh Chromium context, types `Buy milk`, presses Enter, reads the visible labels and saves a screenshot. prq separately uses an e2e browser agent and an independent judge. The first attempt is retained in `evidence/todomvc-attempt-1`; both prq rows were `unverified` after a defect in this benchmark's static server stopped it on a missing asset. The first baseline oracle found the expected label; its mutated-state oracle could not connect to the stopped server and established no behavior. The server was corrected before the subsequent pair.

This demonstrates command and browser verification on two external projects. Browser verification consumes a reachable URL and visible behavior rather than framework source. Command verification runs a repository's declared checks. The measured scope is one Backbone example and one JavaScript library. React, Vue, native apps, arbitrary languages, deployment setup and other frameworks are not established by these four measured rows. Local app preparation and dependencies still matter.

## Reproduce

Use Node 24.8 or newer, git, npm, an available Chromium browser for Playwright, and `OPENAI_API_KEY` in the environment. `run.mjs` installs the pinned e2e dependencies alongside TodoMVC if absent. If Chromium is absent, install it with the pinned `playwright-core` CLI before the browser run. The benchmark fetches source into a disposable directory under `/tmp`; it does not vendor the repositories. New results default to `<target-root>/results/<target>` so rerunning does not overwrite the committed evidence.

```sh
export PRQ_BINARY=/absolute/path/to/prq/packages/cli/dist/index.js
export PRQ_TARGET_ROOT=/tmp/prq-public-validation
export PRQ_EXTERNAL_OUTPUT=/tmp/prq-public-results/clsx
node bench/external/run.mjs clsx
export PRQ_EXTERNAL_OUTPUT=/tmp/prq-public-results/todomvc
node bench/external/run.mjs todomvc
```

The measured CLI SHA-256 was `47baca0ecf371f8f945f53c9567af133405dba5b68f99c42abf8e14e75e0d227`. A different binary is recorded as a different tool and cannot be presented as a reproduction of this exact build. The browser models were `gpt-6.1-sol`; classification and independent judging used `gpt-6-luna`. The model labels do not pin a provider snapshot.

The harness refuses tracked changes or an unexpected repository HEAD, creates a local defect commit, runs the same claim again, then checks out the pinned upstream commit. TodoMVC is served only on `127.0.0.1:4317`, and the owned server is stopped after the pair. Keep that port free. Runtime downloads, API access, screenshots and browser installation are local execution requirements, not evidence of broad portability. The subprocess that executes upstream tests receives no OpenAI key.

Each measured pair has `evidence/<target>/results.json`, full Proof Request pages under `baseline/` and `mutated/`, and the deterministic oracle outputs. Inspect the saved proof rather than inferring a result from the benchmark process exit code. prq can complete a run whose rows are `unverified`.

Public command metadata replaces machine-specific executable and checkout paths with `<node-24.11.0>`, `<prq-cli>`, `<prq-source>`, and `<target-root>`. Machine-specific paths in three captured oracle outputs are also replaced with these placeholders. Assertion text, counts, exit codes, timings, claims, and verdicts are unchanged. Original runner traces retain their run-relative locations; use each Proof Request's evidence links to open the copied screenshots.
