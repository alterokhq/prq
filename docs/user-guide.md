# Using prq

Start with the [quickstart](../README.md#try-it). This guide covers configuration, automation, evidence boundaries and troubleshooting.

## Requirements

Use Node.js 24.8 or newer, npm, and Git. Run prq inside the project repository with a committed `HEAD` and installed project dependencies. The npm package is `@alterok/prq`; the executable is `prq`.

Install it once in your project:

```sh
npm install --save-dev @alterok/prq
npx prq --version
```

For a one-off invocation without a project installation, use `npx @alterok/prq` followed by the same arguments.

## Providers and models

Use either direct OpenAI or OpenRouter. There is no prq account or consumer-specific backend dependency. Both providers support extraction, classification, browser testing and independent judgment. Models must support structured output; browser testing and screenshot judgment also require image input.

```sh
# Direct OpenAI; defaults to gpt-6.1-sol.
export OPENAI_API_KEY="your-key"

# Alternatively, choose OpenRouter and a model available to your account.
export PRQ_PROVIDER=openrouter
export OPENROUTER_API_KEY="your-key"
export PRQ_MODEL="provider/model-id"
```

The model ID above is a placeholder. Choose a supported model from your provider. `--provider`, `--model` and `--judge-model` override `PRQ_PROVIDER`, `PRQ_MODEL` and `PRQ_JUDGE_MODEL`. OpenAI keeps the 0.1 Decisions endpoint for classification and judgment, defaulting to `gpt-6-luna`. Set `--decision-mode structured` or `PRQ_DECISION_MODE=structured` to opt into structured model assessments. OpenRouter uses structured mode. In structured mode the judge defaults to the selected model in a separate context; `--judge-model` overrides it. In Decisions mode that flag selects the model for both classification and judgment. The report records `configuration.decision_mode`. If only an OpenRouter key is present, that provider is selected automatically; if both keys are present, the default is OpenAI. Selecting a provider never falls back to the other key. OpenRouter requires an explicit model.

The CLI reads `.env` in the current directory without overriding existing environment variables. Keep it uncommitted. Keys stay in the execution environment, not command flags, generated configuration or model accounting. Model calls incur usage charges. PRQ makes no automatic transport retries for extraction, classification or judgment. A transient rate limit or server error can stop verification; retry manually after checking provider availability and budget. This is a deliberate change from 0.1 extraction, which allowed two retries. Browser execution follows the external runner's request policy.

Reports record provider, model, available token counts and provider-reported cost for extraction, classification and judgment. Decisions responses do not supply accounting through this client, so their counts and costs remain unknown. OpenRouter cost is read from response metadata. Direct OpenAI does not supply a dollar cost here, and this version cannot collect browser-runner costs. Unknown costs are `null`; a known subtotal never appears as a complete run cost. Budget or authentication failures during judgment leave supporting claims unverified while preserving recorded evidence. A failure before extraction completes produces a structured error, not a fabricated run.

## Browser setup

Install the tested browser dependencies in the application repository:

```sh
npm install --save-dev e2e@0.22.0 @e2e-dev/web@0.15.4 @ai-sdk/openai@4.0.106 ai@7.0.158
npx --no-install e2e-web install chromium
npx prq init
```

Install Chromium explicitly before the first check. A first-run browser download can exceed the check timeout. Command-only checks do not need these browser packages or `init`.

`init` creates missing `e2e.config.ts` and `.pr/`, creates or updates its marked instruction block in `AGENTS.md`, and adds generated artifacts to `.gitignore`. It preserves existing configuration. If `.codex/` exists, it also prepares the optional hook described below.

New configurations provide a working browser target. Each prq run supplies a temporary, independent `prq` agent using the selected provider and model, without modifying this file or inheriting the project agent's context. The wrapper is created next to the original configuration and removed after the subprocess exits; The runner adds its filename pattern to the repository's local Git exclude file before writing, including in projects that have not rerun `init`. `init` also adds a shared ignore pattern. prq overrides target URLs with the selected application URL. Existing target setup, credentials and cache settings remain available:

```ts
import { openai } from '@ai-sdk/openai';
import { web } from '@e2e-dev/web';

export default {
  targets: [{
    engine: web({ browser: 'chromium' }),
    app: { url: process.env.PRQ_APP_URL ?? 'http://localhost:3000' },
  }],
  agents: { default: {
    model: openai('gpt-6.1-sol'),
    judgmentTimeout: 60000,
  } },
  reporters: ['list', 'markdown'],
  cache: { mode: 'read-write', dir: '.e2e/cache' },
};
```

Start the app separately using its normal development command. The URL defaults to `http://localhost:3000`. Set `PRQ_APP_URL` or pass `--app-url` to change it; the flag takes precedence. prq does not start or deploy your application.

## Inputs and commands

Save the agent's completion message with one claim per sentence. Preserve its actual claims rather than rewriting them around what you expect to hold.

```sh
npx prq --claims done.md
cat done.md | npx prq --from-stdin
npx prq                          # use the last commit message when no other input is supplied
npx prq --claims done.md --app-url http://localhost:3000
npx prq --claims done.md --timeout 180000
```

`--claims` selects a file. Otherwise prq reads available stdin, falling back to the last commit message. `--from-stdin` requires stdin as the source. `--timeout` takes milliseconds, from 100 to 3,600,000; the default is 120,000.

`--quiet` hides terminal output. `--json` emits the complete report and `--summary` emits a compact summary, both without progress text on stdout. prq never opens a browser or generates HTML reports.

```sh
npx prq fix
npx prq fix --copy
npx prq fix --run .pr/runs/<run-id>/proof-request.json
# Apply the fix. Commit changes that command checks should cover.
npx prq rerun
npx prq show
npx prq show --json
npx prq show .pr/runs/<run-id>/proof-request.json
```

`fix` prints a prompt for broken claims and rejected human signoffs, preserving reviewer feedback and pointing to a targeted rerun. `--copy` requires a supported clipboard tool. Reruns create separate run directories, retain the exact claim text and lock, and collect new evidence. Browser setup actions may replay from e2e's cache, but assertions execute live. Cached actions are never cached verdicts.

Use `--claims-json` for a builder-authored handoff and `--strict` to block unsigned human claims or unfinished work. `rerun --run <report>` and `signoff --run <report>` select a particular run. The offline `gate` checks that report against the original handoff and current commit before PR creation. See the [agent workflow](agent-workflow.md).

`--project service` selects a repository-relative project directory for command discovery, execution and browser configuration. With no flag, a new run uses the invocation directory; reruns keep their recorded project, or the repository root for old reports. Files passed to `--claims`, `--claims-json` and `--run` remain relative to the invocation directory. Environment files also load from the invocation directory. Artifacts stay at the repository root.

## Human decisions

```sh
npx prq signoff c5 --by "Sam" --accept --reason "Reviewed the readability claim"
npx prq signoff c5 --by "Sam" --reject --reason "Needs clearer wording"
```

Choose exactly one of `--accept` or `--reject` for a claim that needs a human. A name is required. These are alternative examples, not sequential commands: a signed claim requires a rerun before another decision. The report retains the named human judgment.

## Agent output and exit codes

```sh
npx prq --claims done.md --json --quiet
```

`--json` emits the full Proof Request with every claim, original source, evidence, model accounting and a `report` path. Evidence paths resolve relative to that report. `--summary` retains the compact summary and broken rows within 300 tokens, with an explicit omitted count and the full report path. These options are mutually exclusive. Startup problems emit `{ "format": "prq-error/v1", "status": "unverified", "reason": "..." }` with exit 2; no claims or run are invented.

| Exit code | Meaning |
| --- | --- |
| `0` | No claim is broken or unverified. Claims may still need a human. |
| `1` | At least one claim is broken. |
| `2` | Verification is unavailable, or a claim is unverified and none is broken. |

Inspect the verdicts and saved evidence rather than treating exit `0` as proof of every claim.

The table above describes non-strict runs. Strict verification also blocks unsigned or rejected human decisions, empty claims and unfinished work. See [strict exit codes](agent-workflow.md#repair-rerun-and-hand-off).

Test-suite claims require a fresh [structured test report](test-evidence.md). Exit zero and console summaries alone no longer establish that a suite passed. Vitest and Playwright reporters preserve skipped tests, retries and setup failures.

A handoff with a nonempty task also gets [task coverage and independent check selection](task-coverage.md). Missing or uncertain coverage blocks strict handoff without rewriting claims. This sends the task to the selected main model and adds up to two requests per run.

Run `prq eval` for no-key safeguard regressions, or explicitly opt into paid judgment with `prq eval --live`. See [evaluations](evaluations.md) for scope, case selection and JSON results.

## Global command and Codex hook

After project installation, use `npx prq`. Install globally if you want the bare `prq` command, commands copied from reports, or the optional Codex Stop hook:

```sh
npm install --global @alterok/prq
prq init
```

When `.codex/` exists, `init` creates or preserves `.codex/hooks/prq-stop.mjs` and adds its Stop entry to `.codex/hooks.json`. Review it with `/hooks` in Codex before relying on it. The hook invokes `prq` on `PATH`, checks the agent's last message, and blocks completion when broken claims are recorded. Other outcomes are reported without becoming evidence that every claim held. Direct CLI use does not require the hook.

## Privacy and execution boundaries

Browser screenshots and bounded interaction evidence are sent to the configured model providers. Command judgment receives exit status and structured numeric test summaries; captured command output stays in the local artifact. The judge is not given source files. Browser execution uses TesterArmy e2e. Extraction uses the selected provider through the Vercel AI SDK. OpenAI classification and judgment retain the Decisions endpoint by default. OpenRouter and explicit OpenAI structured mode use separate AI SDK calls with validated structured output. Structured-mode judge probabilities are model assessments, not calibrated accuracy measurements. Their unchanged verdict cutoffs have not been compared with Decisions in live evaluations; changing mode may change verdicts.

Command checks run in a temporary checkout of committed `HEAD` with copied installed dependencies. They exclude uncommitted edits. The checkout is not an operating-system sandbox; repository commands still execute on your machine.

Browser checks target the supplied running URL. The report records that URL and the checkout's Git commit, but does not establish that the running application was built from that commit. A model statement or an HTTP availability response alone is not behavioral proof.

Reports remain under `.pr/runs/`. Review their contents before sharing: they can include application screenshots and command output. Keep the evidence files with the report. See [report format](report-format.md) for the saved files and schema.

## When a check is unverified

Check the source file, API key and model access, installed tools, application URL, and project configuration. Missing dependencies, unreachable apps, blocked interactions, timeouts without relevant completed assertions, and insufficient evidence do not become held claims. Existing `e2e.config.ts` files are preserved by `init`; inspect them when a model or executor is unavailable.

A recorded contradiction can remain broken even if independent judgment is unavailable. Inspect the row's evidence and limitations. See the [architecture](architecture.md#verdicts) for the exact verdict rules.

## Recorded experiments

The [external repository checks](../bench/external/README.md) cover clsx's existing test suite and one TodoMVC Backbone interaction. Each selected baseline held and each deliberate defect was broken by the recorded benchmark CLI. The [saved results](../bench/external/results.json) retain four primary rows and earlier setup attempts.

The separate [seeded fixture benchmark](../bench/README.md) contains twelve cases. Eight independently confirmed defects reached prq: five broken target verdicts, one needs a human, and two unverified attempts. Four cases were blocked during backend setup. [Per-case results](../bench/results.json) preserve missing or weak evidence. These experiments do not estimate accuracy across repositories, frameworks, or real bug reports.

## Migrating from 0.1

- Use `--summary` wherever an integration expects the old compact `--json` output. `--json` now returns the full report.
- Use `prq show` or `prq show --json` instead of `open` or `render`. These inspection commands require no model key.
- New runs write format 0.2 JSON and evidence only. Existing 0.1 reports and their claim locks remain readable; a rerun writes a new 0.2 run without changing the old artifact.
- `--no-open` is accepted as a hidden compatibility flag but has no effect. Browsers are never opened automatically.
- Rerun `init` after upgrading. It replaces only its marked AGENTS block and upgrades an exact, unmodified 0.1 Stop script to `--summary`. Customized scripts are preserved with a migration note; update their flags manually. Project configuration and unrelated instructions remain unchanged. This is still a completion hook, not an enforced before-PR gate.
- Historical benchmark artifacts describe their recorded binary and models. They do not evaluate the new provider adapters; run fresh evaluations before drawing conclusions about live accuracy.

When saving a historical run, the CLI archives generated `index.html`, `card.html` and `summary.md` under names containing `.pre-0.2` before updating JSON. These are historical snapshots; use `prq show` for the current decision. Removed `open` and `render` commands explain the replacement and exit 2.
