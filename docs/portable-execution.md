# Portable execution prototype

PRQ checks the same locked promises before a PR and on its head commit in CI. The
CLI owns extraction, evidence, judgment and strict exit codes. Execution adapters
prepare a process and retain its output; they never change a claim or recalculate
a verdict. No planning product or hosted PRQ account is involved.

This is a prototype. The shared adapter has subprocess tests using the real CLI,
including an injected provider HTTP 402 after an actual command finishes. The
Dagger module has not yet been exercised against an engine. Do not treat it as a
validated release or relax existing checks because it is present.

## Report identity

New reports contain `execution.location`, either `local` or `ci`, and
`execution.executor`, either `cli`, `dagger` or `github_actions`. `subject.head`
identifies the committed source checked. `application_revision` stays `unknown`:
a process label or checkout SHA cannot attest to what an external app URL serves.
These fields are process-reported context, not cryptographic attestations.
Old reports remain readable; missing execution context means unknown.

The CLI detects CI from `CI=true` or `CI=1`. An adapter sets
`PRQ_EXECUTION_LOCATION` and `PRQ_EXECUTOR` explicitly. `show` preserves this
context; a rerun records its new environment instead of copying the old one.

## Shared pipeline

Prepare Node 24.8+, Git, the built PRQ CLI and the project's normal dependencies,
browser and services. Start with a committed checkout. Run the initial handoff
with the ordinary CLI, then retain the full report containing its lock.

Run the adapter from the PRQ checkout, passing absolute paths where appropriate:

```sh
node scripts/portable-run.mjs \
  --cli /tools/prq/packages/cli/dist/index.js \
  --cwd /work/project \
  --report /inputs/original-proof-request.json \
  --head "$EXPECTED_HEAD" \
  --location local
```

`EXPECTED_HEAD` is the full source commit SHA. The adapter rejects a different
checkout or tracked modifications before making model calls. It invokes
`prq rerun --strict --json`, preserving the original claims and task. A different
run ID, matching lock and matching checked commit are required. A previous report
cannot become a new pass when startup fails.

Exit codes remain PRQ's: 0 complete, 1 broken or rejected, 2 unresolved or
unavailable. Each invocation creates a separate `.pr/executions/` directory with
`execution.json`, diagnostics and a copy of the fresh report when one exists.
Retain `.pr/runs/` too: that is where evidence paths resolve. Provider failures
leave completed evidence in the report and unfinished judgment unverified.
An outer process timeout may leave only partial artifacts without a finalized
report; the execution outcome then records exit 2, never a pass.

`--collect` retains those same exit codes in `execution.json` but returns process
exit 0 after collection. It exists for container engines to export files before
running the separate gate. It is not a successful verification signal.

## GitHub Action

The JavaScript action uses Node 24 and has no Docker or shell dependency. It is
intended for GitHub-hosted and self-hosted runners on Linux, macOS and Windows
that support Node 24 actions. Framework compatibility still depends on the
prepared environment and PRQ's runners. Windows execution is not yet validated.

The calling workflow prepares the tool and application; the action does not
install arbitrary dependencies with provider credentials present. `cli` points
at a built CLI from this same reviewed PRQ revision, not an older npm release.
Pin the action to a reviewed full commit SHA. A typical verification step is:

```yaml
- name: Verify the same promises
  id: prq
  uses: alterokhq/prq@REVIEWED_FULL_COMMIT_SHA
  with:
    cli: /tools/prq/packages/cli/dist/index.js
    report: .pr-input/original-proof-request.json
    head: ${{ github.event.pull_request.head.sha }}
  env:
    OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
    PRQ_PROVIDER: openrouter
    PRQ_MODEL: ${{ vars.PRQ_MODEL }}
    PRQ_APP_URL: http://127.0.0.1:3000
```

Checkout `github.event.pull_request.head.sha` explicitly. GitHub's default merge
commit is not that head. The action cross-checks the event and refuses
`pull_request_target`. Run only trusted code with provider credentials. Fork PRs
without credentials require a separate approved execution; do not expose secrets
to a fork to obtain a green result.

Use an `always()` artifact step to retain the `evidence-directory` and
`execution-directory` outputs even on failure. No report is automatically posted
as a comment, and no raw artifact is automatically made public. Missing
credentials or setup are unresolved runs, not skipped successes.

## Dagger 1.0 beta

The prototype module is in `integrations/dagger`, with a
`dagger-module.toml` manifest and a native `@check`. Its API accepts a prepared
`Container`, original report `File`, adapter scripts `Directory`, CLI path,
expected head, execution location and a fresh invocation nonce. Supply Git
metadata as a real checkout inside the container, not a host worktree pointer.

Compose the container in your project's pipeline using its normal toolchain and
Dagger `Service` bindings. Supply provider credentials through Dagger `Secret`
values and `withSecretVariable`, sourced from the shell. Install dependencies
before adding credentials. The module makes no assumption about an app framework
or test framework. That same composed pipeline can target a local engine or a
remote engine you already operate.

Pass a newly generated UUID as `nonce` on every invocation. This invalidates the
verification execution layer while allowing dependency setup to remain cached.
Reusing a nonce may replay an old execution and is not fresh verification.

The module's `verification` check reads PRQ's strict exit code. Its `reports` and
`evidence` functions export typed directories even when that check fails. One
PRQ run is currently one native Dagger check; individual claim rows remain in the
JSON report. Per-claim native test collections are a follow-up, not claimed by
this prototype.

Engine validation, a second-machine Dagger run and a locked consumer example
remain required before recommending the module. This repository does not connect
Dagger Cloud, provision infrastructure or build a custom Actions runner.

References: [Dagger 1.0 beta](https://dagger.io/blog/dagger-10-beta/),
[Dang module API](https://docs.dagger.io/reference/sdks/dang/),
[native checks](https://docs.dagger.io/using/checking/).
