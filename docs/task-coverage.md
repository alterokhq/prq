# Task coverage before handoff

An agent can make five true claims while omitting the sixth thing you asked for. Include the original task in a `prq-claims/v1` handoff so PRQ can compare the task with the claims before a strict handoff. PRQ accepts ordinary task text; no planning service or account is required.

```json
{
  "format": "prq-claims/v1",
  "task": "Search ignores case. Show an empty state when no items match.",
  "source": "Search ignores case.",
  "unfinished": [],
  "claims": [
    { "id": "search", "text": "Search ignores case.", "kind": "browser" }
  ]
}
```

The empty-state requirement has no corresponding promise here. If the assessment identifies that omission, it remains visible even when the search claim holds. Coverage does not add a claim on the builder's behalf or change the existing claim lock.

## Separate contexts

With a nonempty `task`, verification makes two additional structured-output requests using the selected main model:

1. Extract verbatim requirements from the original task, without the builder's claims or completion message.
2. Map every extracted requirement to claim IDs, and independently select a check for every claim. This context sees requirement text, claim IDs and exact claim wording, and the repository command allowlist. It does not see the builder's proposed routes, setup, command or reasoning.

The selected checks then run through the existing runners. The evidence judge still receives only the claim and recorded evidence, not the task or builder's reasoning. Direct OpenAI retains its existing Decisions judgment default; task coverage uses structured output through the main model. OpenRouter models must support structured output.

PRQ validates verbatim requirement quotes, unique IDs, complete mappings, referenced claims and allowed commands. A coverage or planning failure saves an unverified report and does not execute the builder's proposed checks as a fallback. Missing requirements can coexist with valid checks, which still run and retain their outcomes. A selected human check still needs named signoff; it is never machine verification.

A fresh rerun preserves the task, claim text and claim lock. It reassesses coverage and check selection, retaining previously extracted requirements for that same task and lock. Newly found requirements are appended; a later extraction cannot silently remove a known requirement.

## Reading the report

`coverage.status` is `not_requested`, `unavailable` or `assessed`. An assessed report contains:

- `task_hash` and `claim_hash`, binding the assessment to the exact task and locked promises.
- `requirements`, with exact task excerpts, IDs, referenced `claim_ids`, a reason, and `covered`, `missing` or `uncertain` status.
- `checks`, with each claim ID, independently chosen kind and check, and a reason. A null kind means no relevant check was selected.

**Covered means promised, not proven.** A model can miss a requirement or overestimate semantic coverage. Passing tests do not establish requirement completeness. Inspect the original task alongside the requirement rows, and keep CI and review enabled. The hashes provide traceability, not authentication or protection against forged reports.

`prq show` displays coverage counts and up to five issues with a pointer to the full report. `--json` retains every row; `--summary` includes a compact coverage status alongside claim counts and the artifact path. Coverage is separate from the four claim verdicts.

## Strict completion and repair

When a nonempty task is supplied, `--strict` and `prq gate` require a matching completed assessment, every requirement covered, and a selected check matching each recorded claim. Missing or uncertain coverage returns exit 2. A broken claim or rejected signoff retains exit 1. The gate remains offline and does not call a model.

Use `prq fix --run <report>` for the next action. Retry an unavailable assessment with a targeted rerun. If a promise was omitted, create a new handoff containing the original promises plus the missing promise and run verification again. This creates a new lock. Do not edit the old lock or weaken its claims. A rerun cannot add promises to an existing lock.

Human signoff accepts a human claim; it does not waive missing task coverage. Keep false alarms visible. A model assessment that cannot establish coverage should not be described as complete work.

## Compatibility and privacy

Without a nonempty task, coverage is explicitly not requested and the existing claim-only workflow remains available. The gate verifies only that supplied handoff; it cannot know about a task that was never supplied or was shortened upstream. Consumer workflows should supply the original task independently of the builder if omission prevention matters.

Old reports remain inspectable. An old report containing a task but no coverage assessment now fails the strict gate until rerun. Explicit task-bearing handoffs previously trusted the builder's routing; they now use independently selected checks. This adds up to two model requests before execution on each run. Their stages, available usage and costs are recorded as `requirements` and `coverage`. Timeouts apply per request, retries remain disabled, and unknown costs remain null.

Task text is now sent to the selected provider for assessment. Keep secrets out of task descriptions. Generated reasons and check proposals are model output, not authority or observed evidence. Coverage does not generate new repository tests, infer arbitrary command behavior from suite counts, start an app, or supply missing runtime setup.
