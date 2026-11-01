# Benchmark fixture

This is the small feedback-board source snapshot used by the seeded benchmark. It contains the original vote storage, browser identity, validation, and tests at source revision `22dd61eb5a3b822e25c18742df1d1b06ac3eacbb`. The project author supplied this source for the public benchmark. It is covered by the repository's Apache-2.0 license.

No existing deployment, account, environment file, Git metadata, or agent instructions are included. `package.json` adds the installed e2e tooling needed to reproduce the experiment. The source snapshot and lockfile are committed; the harness creates each correct feature baseline and exact mutation separately.

From this directory, run `pnpm install --frozen-lockfile`. Then run the benchmark from the repository root as described in `../README.md`. The harness starts anonymous local Convex deployments in disposable case directories; the initial run may download the local backend binary. Do not point the fixture at a shared or production backend.

The original `app/page.tsx` is retained for provenance. `bench/fixture.mjs` replaces it with the experiment UI during preparation, adds explicit rejection/latency examples, and preserves the existing test files. The live demo application is separate.
