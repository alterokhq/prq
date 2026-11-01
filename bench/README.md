# Seeded benchmark

This benchmark plants one defect at a time in isolated copies of a feedback board. It records existing tests, deliberately authored happy-path checks, an independent baseline oracle, and prq separately. It does not assume any of those checks detect a defect.

The public baseline source and lockfile are included in `fixture/`; no private checkout is required. Install its dependencies before running. The harness copies installed dependencies into each disposable checkout; it never writes to the source application or reuses its backend state. An optional `--source /path/to/feedback-board --ref <commit>` can use a compatible external Git checkout instead.

```sh
(cd bench/fixture && pnpm install --ignore-scripts --frozen-lockfile)

# Create all twelve correct feature baselines, done messages and authored checks.
node bench/run.mjs prepare --fixtures-root /tmp/prq-bench-fixtures --case all

# Record baseline/seeded existing and authored checks for one case.
# Case 07 also has a deterministic unit oracle for its vote-count default.
node bench/run.mjs controls --fixtures-root /tmp/prq-bench-fixtures --case 07

# Run a fresh baseline and seeded application, then invoke a built prq CLI.
# Use a fresh fixture root AND results file for a repeated experiment.
node bench/run.mjs run --fixtures-root /tmp/prq-bench-live --case 07 --results /tmp/prq-bench-live/results.json --prq /path/to/prq/packages/cli/dist/index.js --browser /path/to/chromium
```

`--browser` is optional if Playwright already has a Chromium executable available. Live prq execution requires `OPENAI_API_KEY` in the environment. Omit `--prq` to check the baseline and mutation with the deterministic browser oracle only. No model usage is implied by preparation or control results.

Each case gets an independent Git clone, baseline commit, seeded commit, done message, and exact mutation patch. Backend state is local to that clone. Ports start at `4300 + 10 × case number`, with two adjacent backend ports; use `--port-base` to choose another unused range. Startup uses anonymous local Convex and removes inherited deployment-selection variables. The live demo application is never switched or reset.

The harness checks all three ports before starting a case and leaves existing processes alone. The harness requests local Convex backend `precompiled-2026-10-22-1447815`; the first run may download that release. The installed CLI still made a latest-version network request during some initializations, so a cached binary does not guarantee offline startup. Next uses its default dev mode. Each live result records the browser model and CLI binary hash. Costs remain unavailable when the CLI does not report them.

The `cases/` directories contain the prepared done messages, authored tests, and exact mutation patches for review. `fixture.mjs` applies each correct baseline before that patch; the existing tests in `fixture/` stay unchanged. The harness records the resulting commit IDs and writes fresh logs and screenshots outside this repository.

## Reading results

The committed live batch contains twelve rows: eight independently confirmed seeded contradictions reached prq, producing five broken target verdicts, one needs a human, and two unverified attempts. Four cases stopped during local-backend initialization. Earlier favorable attempts are preserved in history and are not substituted into that batch. Broken is the recorded verdict; the limitations in `results.json` describe weak or missing judgment evidence in individual rows.

The separate complete unit-control experiment records six detections in ten comparable existing-suite pairs and none in twelve authored-check pairs. Cases 04 and 10 changed behavior that the old suite expected, so their old-suite baselines do not hold. These are different coverage denominators from the live batch.

`results.json` contains only operations actually attempted. `prepared` means files exist; it does not mean a bug was verified. Unit and browser outcomes use held, broken, or unverified. A seeded contradiction is counted only after the corresponding correct baseline held. Cases 04 and 10 add features that deliberately change old behavior; their existing-suite baseline can be broken, making the old-suite detection comparison unavailable rather than a detection.

`existing_detected` and `author_detected` compare each suite with its own baseline. `mutation_confirmed` requires an independent oracle to establish the intended contradiction. `prq.verdict` is read from a fresh full Proof Request and matched to the exact target claim, not inferred from CLI exit status. Missing target claims, blocked execution, and absent reports do not count as detections. Cost remains null unless a report actually records it.

The generated `index.html` presents measured denominators, including confirmed cases attempted without a full target report. It never fills unexecuted cases with expected results. Artifact paths in JSON are relative to the disposable fixture root named by `artifacts_root`; keep that directory to inspect logs, screenshots, and reports. For the committed live batch that directory is `bench-final`; the separate controls use `bench-fixtures`.

## Limits of the method

This is one application with twelve deliberately chosen mutations. The done messages and happy-path tests are authored for the experiment; they are not an unbiased sample of autonomous agent output. Existing tests remain unchanged and may detect defects the authored checks miss. The deterministic oracle knows the expected behavior and is used to establish the experiment, not as evidence supplied to prq's judge.

Some cases require correct baseline features absent from the original app. `cases.mjs` describes those additions and `fixture.mjs` applies them before planting a defect. Rejection and latency use visible, named fixture items. No measured result should be generalized to all coding agents or all software.

## Recorded attempts

`history/seed07-provider-blocked.json` preserves the initial unverified prq attempt: the configured decision executor requested an unavailable text model. Current preparation uses the verified `gpt-6.1-sol` browser executor. The judge remains independent. Changing that configuration is an experiment setup correction, not a detected defect.

Other history files preserve startup blockers: an occupied port, a missing direct Next runtime helper, and an unsuccessful request for the latest Convex backend version. The public fixture declares `@swc/helpers` explicitly and the harness pins the backend release. Blocked baseline or seeded startup does not count as a prq execution. History artifacts remain relative to the named fixture directory; they are not bundled screenshots or logs.
