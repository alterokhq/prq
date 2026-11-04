# Repeatable evaluations

`prq eval` checks PRQ's decision policy against a versioned set of synthetic evidence and tasks. It prints terminal results or complete JSON. No report app, Git repository, browser or provider credential is required for the default mode.

```sh
prq eval
prq eval --json
prq eval --case zero-tests,omitted-requirement --out /tmp/prq-eval-first.json
```

Every row retains its expected and actual outcome separately, elapsed time, execution mode, evidence or task inputs, and available model usage. A saved file is never overwritten. Choose a new path for each experiment. Exit 0 means all selected cases matched; exit 1 means at least one mismatch; exit 2 means invalid setup or arguments.

## What runs

The nine initial cases cover:

| Case | Expected result |
| --- | --- |
| `known-good` | Held for a fully passing structured suite |
| `seeded-defect` | Broken for a recorded failed assertion |
| `zero-tests` | Unverified |
| `unknown-counts` | Unverified |
| `missing-service` | Unverified |
| `unsupported-behavior` | Unverified when suite counts are used to claim application behavior |
| `provider-budget` | Unverified after an injected HTTP 402 response |
| `covered-task` | Complete task-to-claim mapping |
| `omitted-requirement` | Coverage gap for the missing promise |

Default mode uses an intentionally optimistic synthetic judge and fixed coverage transcripts. It exercises the same production parsers, coverage policy and judge guards without network requests. The provider-budget case always uses a local injected failure, including in live mode. It does not exhaust a real account or bill a provider.

These are **safeguard regressions, not a measured defect-detection rate**. The seeded defect is represented by synthetic failed-assertion evidence, and the missing service by unavailable-run evidence. This command does not start an app, plant a real code defect or generate real browser observations. The existing [seeded application benchmark](../bench/README.md) is separate and retains its historical results and limitations.

Both the core case suite and built-CLI acceptance test run under `pnpm test`, so the existing CI matrix exercises deterministic evaluations. CI does not run paid provider evaluations.

## Explicit provider evaluation

Use `--live` to send the fixed evidence and tasks through the selected provider and model configuration. This spends provider credits. Configure your own key and model as in the [user guide](user-guide.md), then start with a single case:

```sh
prq eval --live --provider openrouter --model <your-model> \
  --case omitted-requirement --timeout 30000 --out /tmp/prq-eval-live-first.json
```

Keys belong in environment variables, never flags or artifacts. `--judge-model` and `--decision-mode` work as in verification. Direct OpenAI retains Decisions judgment by default; coverage always uses the main model's structured output.

Live mode replaces synthetic model replies with actual provider judgment; the evidence remains synthetic. It tests semantic judgment and requirement omission on these cases, not a deployed application or agent's ability to gather evidence. Deterministic evidence guards still short-circuit unsupported inputs. The current full suite makes at most five ordinary model requests: one supporting-suite judgment and two requests per coverage case. Fault injection remains local. No automatic retries are made; a provider error becomes an unavailable outcome and can make a case mismatch.

The provider receives only the evaluation input, not its expected outcome or the synthetic transcript. Expected outcomes remain fixed when a model disagrees. Compare runs with the same fixture hash and disclose the sample size. No paid evaluation results are shipped with this change.

## JSON and interpretation

`prq-eval/v1` contains a unique run ID, timestamp, CLI version and executable SHA-256, fixture set/version and hash, mode, optional provider configuration, all case rows and aggregate counts.

- A false pass is an actual held or complete-coverage result where the fixed expectation is nonpassing.
- A false alarm is an actual broken or coverage-gap result where the fixed expectation is held or complete coverage.
- Unverified, uncertain and unavailable outcomes remain visible in each row. All disagreements count as mismatches, even when neither false-pass nor false-alarm applies.

Each live row retains reported token counts and costs through the existing accounting contract. Unavailable prices remain null; a partial reported subtotal is not a complete cost. Offline mode records zero provider spend because it makes no network requests. Wall-clock time is measured for each case.

A successful offline run does not justify relaxing CI. The next application-level controls should record a real baseline, a confirmed seeded defect, its fixed rerun and a stopped-service result with the same claims. A consumer pilot should separately record pre-PR repairs, later CI/review defects, false alarms, time and human intervention. This small synthetic suite cannot measure avoided post-PR work.
