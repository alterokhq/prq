# Report format

Each execution writes a separate directory under `.pr/runs/<run-id>/`. Version 0.2 produces JSON and evidence files, with no report server or HTML generation.

| File | Contents |
| --- | --- |
| `proof-request.json` | Full claims, verdicts, evidence, original source, lock, subject, provider configuration and available accounting |
| `claims.lock.json` | Claim IDs and exact text locked before checks run |
| `evidence/` | Browser screenshots, step evidence and structured test reports, when collected |

Command output is captured in the JSON evidence. Structured command evidence adds `test_summary` and a path to the retained test report; see [test evidence](test-evidence.md) for the contract and attachment paths. Evidence paths are relative to the run directory. Keep those files together when copying a run. `.pr/last.json` is a copy of the latest saved Proof Request used by `show`, `fix` and `rerun`.

```sh
npx prq show
npx prq show --json
npx prq show .pr/runs/<run-id>/proof-request.json --json
```

The [JSON schema](../proof-request.schema.json) is the artifact contract; [schema.ts](../packages/core/src/schema.ts) is its zod source of truth. The CLI reads historical 0.1 reports and writes new runs as 0.2. Stored verdicts remain `held`, `broken`, `needs_human`, and `unverified`. Human signoff retains the person's name, decision, reason when supplied, and timestamp.

The claim lock is SHA-256 over the ordered claim IDs and exact text. Reruns preserve it and save fresh evidence in a new directory. A source commit identifies the command checkout; a browser URL does not establish which commit the running app serves.

`subject.project` records the selected directory relative to the repository root, using `/` separators and `.` for the root. Reports without this field are treated as root-project runs. Explicit builder input adds `handoff` with `format: "prq-claims/v1"`, optional `task`, and `unfinished`. Reruns retain those fields. See the [handoff contract](agent-workflow.md#submit-explicit-claims).

## Terminal JSON

`--json` emits the entire report, plus an absolute `report` path that locates its saved artifact. It includes every claim and evidence field without a token limit. This path is CLI metadata, not a field in the stored artifact schema. The original completion text remains in `source.text`.

`--summary` is the optional compact view: counts, broken rows, an omitted-row count and the report path within 300 tokens. It does not replace the full artifact. `--json` and `--summary` cannot be combined.

If setup or extraction fails before a report exists, machine-readable output is an error object with `format: "prq-error/v1"`, `status: "unverified"` and a safe `reason`, with exit code 2. It does not invent a claim list, lock or saved run. A provider failure after execution leaves recorded evidence available in the run.

## Models and cost

`configuration` records the selected provider, model and judge model without credentials. `model_usage` records stages whose request or external browser process was started, selected provider/model, status, available input/output token counts and provider-reported `cost_usd`. A completed request means a response was received; it does not imply the claim held.

OpenRouter costs are read from its response metadata. Decisions calls expose neither token nor cost accounting here. Direct OpenAI calls do not expose dollar costs in this implementation. Browser-runner accounting is currently unavailable and is recorded as `external`, with null counts and cost. No estimates or provider prices are silently substituted.

`timing.cost_usd` is null unless accounting is complete for every recorded stage. `reported_cost_usd` is the known subtotal, or null when nothing is known; `cost_complete` makes the distinction explicit. A real zero is retained as zero. Reports show partial or unknown cost in the terminal as well.

## Historical evidence

The independent format is defined in [SPEC.md](../SPEC.md). The [recorded six-claim search demo](../examples/search/README.md) and [external experiments](../bench/external/README.md) retain their original 0.1 artifacts, including historical HTML where present. These are evidence of their recorded builds, not live validation of 0.2 or its new provider adapters. Saving a historical run archives its generated pages with `.pre-0.2` filenames; they no longer represent the current JSON. The legacy renderer package remains for historical consumers and is no longer bundled into the CLI.
