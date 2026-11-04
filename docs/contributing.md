# Contributing

Read `AGENTS.md` and the relevant package before changing behavior. Use Node.js 24.8 or newer and pnpm 11.20.0. Install the locked dependencies with `pnpm install --frozen-lockfile`.

Use an isolated worktree. Coordinate shared interfaces, schemas, manifests, and lockfiles when several contributors are active.

## Local checks

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
node packages/cli/dist/index.js eval --json
pnpm typecheck
pnpm lint
node packages/cli/dist/index.js --help
```

Run focused checks while working and the relevant workspace checks before handing off. Build before the first test run because the CLI acceptance test exercises the built binary. Rebuild after source changes before runtime validation. Type checking uses the no-emit source configuration and does not change built artifacts. Core and renderer tests can run without an API key. Live verification uses your selected provider key and incurs provider usage.

For CLI changes, inspect terminal and redirected output, complete JSON and compact summaries. Cover all four verdicts, missing evidence, long claims, provider failures and unknown costs. The legacy renderer remains only for historical consumers; new CLI runs never generate HTML.

For browser-runner changes, read the installed e2e documentation, especially `docs/cache.mdx` and `docs/ci.mdx` inside the package. Compare the parser with `fixtures/e2e-report.sample.json` and a fresh report. Keep raw runner statuses at the integration boundary and map them to the four public verdicts.

## Try a local package

Run `node /absolute/path/to/prq/packages/cli/dist/index.js` from the application repository after building. To install the local CLI package:

```sh
(cd packages/cli && pnpm pack --pack-destination ../../dist)
npm install --global ./dist/alterok-prq-0.2.0.tgz
```

Internal `@prq/*` packages are bundled into the CLI and are not published separately. Keep the zod schema in `packages/core/src/schema.ts` synchronized with [proof-request.schema.json](../proof-request.schema.json).

## What evidence means

Separate three kinds of result in a handoff:

- Fixture or unit checks establish behavior against recorded inputs.
- Transport and CLI integration checks establish configuration and output behavior, not live model accuracy.
- Live application runs establish only the claims and environment actually checked.

A fixture's expected counts, a generated card, or a compiled CLI is not proof that the live application journey held. Record blocked and unverified cases without rewriting claims. Benchmark summaries must identify executed seeds and must not turn planned cases into measured results.

## Keep contributions portable

Do not commit API keys, `.env`, run artifacts, personal paths, or organization-specific integration plans. Public setup instructions must work from a checkout without private documents. Preserve genuine dependency and asset attribution.

Use Biome for formatting and linting, vitest for tests, and tsdown for builds. Keep commits small enough to review, with an imperative one-line message describing the user-visible change. A handoff should include the commit, behavior changed, checks actually run, and remaining limitations.

For coverage changes, test missing/uncertain requirements, invalid references, independent check selection, fresh reruns and provider failure. Preserve the distinction between a model assessment and observed implementation evidence. [Evaluation cases](evaluations.md) keep expected outcomes separate from judgments.
