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

Set `OPENAI_API_KEY`. Your OpenAI account needs access to `gpt-6.1-sol` and the Decisions API with `gpt-6-luna`. Model access is required even for command-only verification. Provider calls incur usage charges. There is no prq account, hosted service, or database.

```sh
export OPENAI_API_KEY="your-key"
```

The CLI also reads `.env` in the current directory if it exists. Keep that file uncommitted.

## Browser setup

Install the tested browser dependencies in the application repository:

```sh
npm install --save-dev e2e@0.22.0 @e2e-dev/web@0.15.4 @ai-sdk/openai@4.0.106 ai@7.0.158
npx --no-install e2e-web install chromium
npx prq init
```

Install Chromium explicitly before the first check. A first-run browser download can exceed the check timeout. Command-only checks do not need these browser packages or `init`.

`init` creates missing `e2e.config.ts` and `.pr/`, appends a scoped instruction block to `AGENTS.md`, and adds generated artifacts to `.gitignore`. It preserves existing configuration. If `.codex/` exists, it also prepares the optional hook described below.

New configurations use e2e's LLM executor with `gpt-6.1-sol` and a 60-second judgment timeout:

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
npx prq --claims done.md --app-url http://localhost:3000 --no-open
npx prq --claims done.md --timeout 180000
```

`--claims` selects a file. Otherwise prq reads available stdin, falling back to the last commit message. `--from-stdin` requires stdin as the source. `--timeout` takes milliseconds, from 100 to 3,600,000; the default is 120,000.

`--no-open` saves the report without opening it. `--quiet` hides live progress and suppresses automatic opening. `--json` emits compact agent output and also suppresses opening.

```sh
npx prq fix
npx prq fix --copy
npx prq fix --run .pr/runs/<run-id>/proof-request.json
# Apply the fix. Commit changes that command checks should cover.
npx prq rerun
npx prq open
```

`fix` prints a prompt for the broken claims. `--copy` requires a supported clipboard tool. Reruns create separate run directories, retain the exact claim text and lock, and collect new evidence. Browser setup actions may replay from e2e's cache, but assertions execute live. Cached actions are never cached verdicts.

## Human decisions

```sh
npx prq signoff c5 --by "Sam" --accept --reason "Reviewed the readability claim"
npx prq signoff c5 --by "Sam" --reject --reason "Needs clearer wording"
```

Choose exactly one of `--accept` or `--reject` for a claim that needs a human. A name is required. These are alternative examples, not sequential commands: a signed claim requires a rerun before another decision. The report retains the named human judgment. Static report controls prepare commands; they do not execute checks or save signoffs in the browser.

## Agent output and exit codes

```sh
npx prq --claims done.md --json --quiet --no-open
```

`--json` emits a summary, broken rows and the full artifact path within 300 tokens. It may shorten or omit rows from that compact view; saved claims remain complete. Startup problems can produce an unverified response without a full report.

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

Browser screenshots and bounded interaction evidence are sent to the configured model providers. Command judgment receives exit status and recognized numeric test summaries; captured command output stays in the local artifact. The judge is not given source files. Browser execution uses TesterArmy e2e; extraction uses the Vercel AI SDK with OpenAI; classification and judgment use OpenAI Decisions.

Command checks run in a temporary checkout of committed `HEAD` with copied installed dependencies. They exclude uncommitted edits. The checkout is not an operating-system sandbox; repository commands still execute on your machine.

Browser checks target the supplied running URL. The report records that URL and the checkout's Git commit, but does not establish that the running application was built from that commit. A model statement or an HTTP availability response alone is not behavioral proof.

Reports remain under `.pr/runs/`. Review their contents before sharing: they can include application screenshots and command output. Keep the evidence files with the report. See [report format](report-format.md) for the saved files and schema.

## When a check is unverified

Check the source file, API key and model access, installed tools, application URL, and project configuration. Missing dependencies, unreachable apps, blocked interactions, timeouts without relevant completed assertions, and insufficient evidence do not become held claims. Existing `e2e.config.ts` files are preserved by `init`; inspect them when a model or executor is unavailable.

A recorded contradiction can remain broken even if independent judgment is unavailable. Inspect the row's evidence and limitations. See the [architecture](architecture.md#verdicts) for the exact verdict rules.

## Recorded experiments

The [external repository checks](../bench/external/README.md) cover clsx's existing test suite and one TodoMVC Backbone interaction. Each selected baseline held and each deliberate defect was broken by the recorded benchmark CLI. The [saved results](../bench/external/results.json) retain four primary rows and earlier setup attempts.

The separate [seeded fixture benchmark](../bench/README.md) contains twelve cases. Eight independently confirmed defects reached prq: five broken target verdicts, one needs a human, and two unverified attempts. Four cases were blocked during backend setup. [Per-case results](../bench/results.json) preserve missing or weak evidence. These experiments do not estimate accuracy across repositories, frameworks, or real bug reports.
