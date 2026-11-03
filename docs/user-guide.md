# Using prq

Start with the [quickstart](../README.md#try-it). This guide covers configuration, automation, evidence boundaries and troubleshooting.

## Requirements

Use Node.js 24.8 or newer, npm, and Git. Run prq inside the application repository with a committed `HEAD` and installed project dependencies. The npm package is `@alterok/prq`; the executable is `prq`.

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

The model ID above is a placeholder. Choose a supported model from your provider. `--provider`, `--model` and `--judge-model` override `PRQ_PROVIDER`, `PRQ_MODEL` and `PRQ_JUDGE_MODEL`. The judge defaults to the same model in a separate context. If only an OpenRouter key is present, that provider is selected automatically; if both keys are present, the default is OpenAI. Selecting a provider never falls back to the other key. OpenRouter requires an explicit model.

The CLI reads `.env` in the current directory without overriding existing environment variables. Keep it uncommitted. Keys stay in the execution environment, not command flags, generated configuration or model accounting. Model calls incur usage charges. Extraction, classification and judgment requests are not automatically retried after a provider error; browser execution follows the external runner’s request policy.

Reports record provider, model, available token counts and provider-reported cost for extraction, classification and judgment. OpenRouter cost is read from response metadata. Direct OpenAI does not supply a dollar cost here, and this version cannot collect browser-runner costs. Unknown costs are `null`; a known subtotal never appears as a complete run cost. Budget or authentication failures during judgment leave supporting claims unverified while preserving recorded evidence. A failure before extraction completes produces a structured error, not a fabricated run.

## Browser setup

Install the tested browser dependencies in the application repository:

```sh
npm install --save-dev e2e@0.22.0 @e2e-dev/web@0.15.4 @ai-sdk/openai@4.0.106 ai@7.0.158
npx --no-install e2e-web install chromium
npx prq init
```

Install Chromium explicitly before the first check. A first-run browser download can exceed the check timeout. Command-only checks do not need these browser packages or `init`.

`init` creates missing `e2e.config.ts` and `.pr/`, appends a scoped instruction block to `AGENTS.md`, and adds generated artifacts to `.gitignore`. It preserves existing configuration. If `.codex/` exists, it also prepares the optional hook described below.

New configurations provide a working browser target. Each prq run supplies a temporary, independent `prq` agent using the selected provider and model, without modifying this file or inheriting the project agent's context. The wrapper is created next to the original configuration and removed after the subprocess exits; `init` ignores its filename pattern in case the process is interrupted. prq overrides target URLs with the selected application URL. Existing target setup, credentials and cache settings remain available:

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

`fix` prints a prompt for the broken claims. `--copy` requires a supported clipboard tool. Reruns create separate run directories, retain the exact claim text and lock, and collect new evidence. Browser setup actions may replay from e2e's cache, but assertions execute live. Cached actions are never cached verdicts.

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

## Global command and Codex hook

After project installation, use `npx prq`. Install globally if you want the bare `prq` command, commands copied from reports, or the optional Codex Stop hook:

```sh
npm install --global @alterok/prq
prq init
```

When `.codex/` exists, `init` creates or preserves `.codex/hooks/prq-stop.mjs` and adds its Stop entry to `.codex/hooks.json`. Review it with `/hooks` in Codex before relying on it. The hook invokes `prq` on `PATH`, checks the agent's last message, and blocks completion when broken claims are recorded. Other outcomes are reported without becoming evidence that every claim held. Direct CLI use does not require the hook.

## Privacy and execution boundaries

Browser screenshots and bounded interaction evidence are sent to the configured model providers. Command judgment receives exit status and recognized numeric test summaries; captured command output stays in the local artifact. The judge is not given source files. Browser execution uses TesterArmy e2e. Extraction, classification and judgment use the selected provider through the Vercel AI SDK, with separate calls and validated structured output. Judge probabilities are model assessments, not calibrated accuracy measurements. The legacy internal Decisions client remains available for historical consumers but is not used by the 0.2 CLI.

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
- Existing hooks and project configuration are preserved by `init`. Review any installed hook when upgrading. The new hook uses `--summary`; it is still a completion hook, not an enforced before-PR gate.
- Historical benchmark artifacts describe their recorded binary and models. They do not evaluate the new provider adapters; run fresh evaluations before drawing conclusions about live accuracy.
