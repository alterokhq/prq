# Proof Request 0.2

A proof request is what a coding agent's claims look like after someone other than the agent has checked them. It is one JSON file, `proof-request.json`, with one row per claim and the evidence behind each verdict.

This document is the format. `prq` is one tool that writes it. A producer must follow the five rules below and emit a schema-valid file. Schema validation alone cannot establish that the contexts were separated or the evidence is sufficient.

- Schema: [`proof-request.schema.json`](./proof-request.schema.json)
- A real example: [`examples/search/proof-request.json`](./examples/search/proof-request.json), with its evidence and limitations described in [the example notes](examples/search/README.md)
- Status: 0.2, draft. The contract may evolve before 1.0.

## The rules

### 1. Claims come from the author's own words

Claims are taken from what the agent said it did: its done message, commit message, pull request body or plan. Each claim is a verbatim sentence or self-contained clause from the source text. The list is locked before any check runs.

The lock is a SHA-256 over the claims in order, as UTF-8 bytes of `JSON.stringify(claims.map(c => [c.id, c.text]))`, with no normalization or added whitespace. It is written as `sha256:<hex>` in `source.hash`. A claim may be refined into a check, and checks may change between runs. The claim text may not. A tool must refuse to rerun or sign off a file whose claims no longer match their lock.

### 2. The author does not verify

Checks run in a context that has not seen the author's reasoning: a fresh agent session, a browser driving the running app, a shell in a clean checkout. The tester receives the claim, its check setup and access to the thing being tested, without the author's reasoning.

### 3. The judge never sees code

The independent judge receives the claim and relevant recorded evidence, never source files. In prq, browser judgment receives bounded steps, assertions and selected screenshots or HTTP observations; command judgment receives exit status and recognized numeric test summaries, not raw output. The artifact may retain more evidence than the judge receives. A model's statement on its own is never evidence.

Judge probability is optional in the artifact: a completed contradiction may remain broken when judgment is unavailable; an otherwise supporting check without available judgment stays unverified. Human signoff remains a named decision, not machine verification. See the [reference verdict rules](docs/architecture.md#verdicts).

### 4. A claim with no runnable check is never held

Without a completed relevant check, the claim is `unverified`. Missing evidence or unavailable judgment for an otherwise supporting check also remains `unverified`. If the claim is a matter of judgement, it is `needs_human`. Neither counts as `held`, in the summary or anywhere else.

### 5. The vocabulary is fixed

Every claim has exactly one verdict:

| Verdict | Meaning |
|---|---|
| `held` | A check ran and the evidence supports the claim. |
| `broken` | A check ran and the evidence contradicts the claim. |
| `needs_human` | A judgement call, or the evidence is not conclusive. A named person decides. |
| `unverified` | Execution or evidence was insufficient to decide. Never counts as held. |

Tools may display `needs_human` as "needs a human".

## The file

Required fields are marked with `*`. The schema is the authority where this table and the schema differ. Run and claim IDs are at most 80 characters and use letters, digits, underscores or hyphens. Claim text is nonempty. Counts, durations and step indices are integers. Producers must also ensure summary counts match the claims and validate the claim lock; these semantic checks are not enforced by JSON Schema alone.

| Field | Type | Meaning |
|---|---|---|
| `version`* | string | `"0.2"` for new reports; the reader also accepts historical `"0.1"`. |
| `id`* | string | This run. A rerun gets a new id and keeps the same lock. |
| `created_at`* | string | ISO 8601 timestamp. |
| `subject`* | object | What was checked: `head`* (commit), and optionally `repo`, `base`, `title`, `app_url`. |
| `source`* | object | Where the claims came from: `kind`* (`agent_message`, `commit`, `pr_body`, `plan`, `file`), `text`* (the original words), `hash`* (the claim lock). |
| `claims`* | array | One entry per claim, below. |
| `summary`* | object | Counts: `held`*, `broken`*, `needs_human`*, `unverified`*. |
| `code` | object | `diff_url`, if the reader wants the code. It is an appendix. |
| `timing` | object | Optional integer `total_ms`; `cost_usd` is a complete total or null; `reported_cost_usd` is a known subtotal or null; `cost_complete` says whether every recorded stage has a cost. |
| `configuration` | object | Selected `provider`, `model` and `judge_model`, without credentials. |
| `model_usage` | array | Per-stage provider/model, status, available token counts and reported dollar cost. See [accounting fields](docs/report-format.md#models-and-cost). |

Each claim:

| Field | Type | Meaning |
|---|---|---|
| `id`* | string | Stable within the lock, e.g. `c1`. |
| `text`* | string | The claim, in the author's words. |
| `kind`* | string | `browser`, `command` or `human`. |
| `check` | object | How it was checked: `path` and `setup` for a browser, `command` for a shell. |
| `verdict`* | string | One of the four verdicts. |
| `probability` | number | The judge's probability that the claim holds, 0 to 1. |
| `observed` | string | One line on what the tester saw. |
| `evidence` | array | Captured evidence, below. The judge may receive a bounded subset. |
| `tester` | string | Who ran the check, e.g. `e2e / independent browser`. |
| `judge` | string | Who decided, e.g. `decisions gpt-6-luna`. |
| `duration_ms` | integer | How long the check took. |
| `cached` | boolean | Whether setup steps were replayed from cache. Assertions always run live. |
| `assignee` | string or null | The person a `needs_human` claim is waiting on. |
| `signoff` | object or null | A human decision: `by`*, `decision`* (`accepted` or `rejected`), `at`*, and an optional `reason`. A signoff is recorded as a person's decision, never as machine verification. |

Each evidence item requires `type`. The schema permits the other listed fields as optional; the table shows conventional use. A syntactically valid empty evidence item is not behavioral proof. Screenshot paths should resolve relative to the artifact directory.

| `type` | Fields |
|---|---|
| `screenshot` | `path`, `step` |
| `assertion` | `text`, `passed`, `step` |
| `http` | `method`, `url`, `status` |
| `console` | `level`, `text`, `step` |
| `command` | `command`, `exit_code`, `stdout`, `stderr` |
| `note` | `text`, `path`, `step` |

## Reading a proof request

Read the claims first. A person should be able to decide from the rows alone: what was claimed, what each check found, and which rows wait on them. If an optional code link is supplied, readers may follow it separately. Missing evidence links or a valid lock do not establish the claim's truth.

## Versioning

`version` is the format version, not the tool version. Version 0.2 adds provider accounting and explicit null costs. The shared reader accepts 0.1 and 0.2; new producers write 0.2 so older consumers can reject unsupported accounting semantics. The current JSON Schema rejects unknown properties and verdicts. Producers must target this version's schema; do not assume additive fields are accepted. Readers may reject unsupported files and must never treat an unknown verdict as `held`.

## License

This specification is Apache-2.0, like the reference implementation.
