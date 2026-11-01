# prq: Proof Request

Your agent said it works. Prove it.

`prq` extracts claims from an agent's done message, locks them, runs independent checks, judges evidence, and writes a static Proof Request.

## Requirements

- Author, tester, and judge use separate contexts. The tester receives the claim and running app, never the author's reasoning. The judge receives the claim and evidence, never source code.
- Preserve exact claim text. Lock the canonical claim list with SHA-256 before checks run. Never edit, drop, normalize, or weaken a claim to obtain a different verdict.
- Model output is not ground truth. Collect actual assertions, exit codes, HTTP responses, logs, and screenshots. A claim without a completed runnable check is never held. Infrastructure problems are unverified.
- v0.1 is a local CLI. No GitHub integration, daemon, server, database, or account. `OPENAI_API_KEY` is the only required environment variable. `PRQ_APP_URL` may override the default application URL.
- `--json` emits summary plus broken rows within 300 tokens. Full evidence belongs in saved artifacts.
- Product terms are held, broken, needs a human, and unverified. Say "the agent". Preserve original source text and raw evidence even when they use other terms.
- Each execution gets a unique run ID under `.pr/runs/`. Reruns preserve the claim lock and write fresh evidence separately. Never overwrite an earlier run because its claim hash matches.
- Browser assertions run live on every execution. Cached setup may be replayed; cached actions are not proof that a claim still holds.
- Keep organization-specific integration plans, promotion, personal machine paths, and private planning outside this repository.

## Packages and boundaries

TypeScript, ESM, Node 24, pnpm workspace, zod 4. `@prq/*` are internal workspace names, not a claim that an npm scope is published.

| Package | Owns |
| --- | --- |
| `@prq/core` | Schema, lock, extraction, classification, Decisions client, judge, Runner and Store contracts, fix prompt |
| `@prq/runner-e2e` | Browser checks through e2e, generated assertions, reports, screenshots and step evidence |
| `@prq/runner-shell` | Command checks in isolated git worktrees, exit status and output |
| `@prq/render` | Static page, card HTML, Markdown from Proof Request JSON only |
| `prq` in `packages/cli` | Orchestration, local storage, terminal output, commands, opening artifacts |

Core domain logic must not import browser tooling, spawn processes, or access the filesystem. Isolate filesystem storage behind Store and an adapter. Rendering has no network dependency and works from local artifacts. Static-page actions produce CLI commands rather than using a local endpoint.

## Execution and evidence

Source → extract → lock → classify browser, command, or human → run → judge → save JSON and render.

`packages/core/src/schema.ts` is the zod source of truth; keep `proof-request.schema.json` synchronized. Verdicts are `held | broken | needs_human | unverified`.

The source fixture is `fixtures/demo-done.md`. The illustrative example contains six claims: four browser, one human, one command. Its summary is four held, one broken, one needs a human. Fixtures are not live verification evidence. Do not drop claims to match an expected count.

A completed check with relevant evidence and probability at least 0.8 can be held. A contradicted check, or probability at most 0.3 with relevant completed evidence, is broken. Ambiguous evidence needs a human. Missing execution or evidence remains unverified. Human claims require named signoff.

The Decisions client is `packages/core/src/decisions.ts`. Classification and judgment each batch questions into one call per Proof Request. Validate responses at the boundary and match answers by unique question names.

## CLI contract

```text
prq                          # --claims file, stdin, or last commit message
prq --from-stdin
prq --claims done.md
prq --json --quiet
prq fix [--copy]
prq rerun
prq signoff <id> --by <name> --accept|--reject [--reason "..."]
prq open
prq init
```

`init` preserves existing configuration, creates missing e2e configuration and `.pr/`, appends a scoped agent instruction block, and installs a stop hook only where supported. Check installed documentation before choosing a hook format.

Rows resolve progressively with `✓ ✗ ? ○`, a braille spinner, red for broken, and green only on the held glyph. Broken rows show `- claimed` and `+ observed`. Finish with counts, elapsed time, and the lock hash.

## Browser runner

Generate one test per browser claim: open the path, perform setup, assert unchanged claim text. Validate report fields against `fixtures/e2e-report.sample.json`: `run.results[]`, `status`, `attempts[]`, `testId`, and `file`.

Read installed e2e `cache.mdx` and `ci.mdx` before changing the runner. The generated configuration uses e2e 0.22, `@e2e-dev/web` 0.15, and the LLM executor with `gpt-6.1-sol`. Classification and independent judgment use Decisions. Use reporters `['list', 'markdown']`; JSON is written separately. Do not combine `json` and `list` reporters.

Copy per-claim logs and screenshots into each run. Recorded artifacts include `.e2e/results/<slug>/trace.md`, `attempt-1/screenshots/`, and `screen-at-failure.txt`. App unavailability, blocked execution, and timeouts without a completed relevant assertion are unverified. Never manufacture HTTP evidence for a browser-only interaction.

## Contribution conventions

Use isolated worktrees and clear ownership boundaries. Integrate contract changes before dependent work. Biome formats and lints, vitest tests, and tsdown builds packages. The CLI should bundle to one entry file. Run checks appropriate to the change and report only checks executed. Never commit secrets, environment files, run artifacts, or personal data. Commit messages are imperative, one line, and describe the user-visible change.

See `docs/README.md` for contributor documentation and `bench/SEEDS.md` for the benchmark method.
