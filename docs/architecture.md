# Architecture

`prq` is a local CLI that turns a completion message into a saved Proof Request. It has no application server, database, hosted account, or GitHub integration.

```text
completion message
  → extract claims
  → lock exact claim IDs and text
  → classify browser / command / human
  → run browser and command checks
  → judge recorded evidence
  → save JSON and evidence
  → fix prompt → fresh rerun with the same claim lock
```

## Package boundaries

| Package | Responsibility | Boundary |
| --- | --- | --- |
| `@prq/core` | Schema, extraction, lock, provider adapters, classification, judgment, fix prompt, Runner/Store contracts | No filesystem access, process spawning, or browser tooling |
| `@prq/runner-e2e` | Generated browser assertions, e2e execution, report parsing, evidence collection | Uses the target project's e2e installation and running application |
| `@prq/runner-shell` | Command checks and recorded exit/output | Fresh worktree of committed HEAD; copied installed dependencies |
| `@prq/render` | Legacy rendering for historical consumers; not bundled into the CLI | Reads a Proof Request value; no network, models, or file access |
| `prq` | Input selection, orchestration, filesystem storage, terminal, commands | Connects the packages and writes `.pr/` |

The `@prq/*` packages are private workspaces bundled into the public `prq` CLI. They do not require separate package publication.

## Locked claims and separate runs

The canonical lock is SHA-256 over the ordered claim IDs and exact text. Capitalization, punctuation, whitespace, and ordering matter. The lock is saved before execution. Routing and setup can be refined without changing what the agent claimed.

A run ID is distinct from the claim lock. `.pr/runs/<run-id>/` contains its lock file, complete Proof Request JSON and copied evidence. `.pr/last.json` stores the latest complete Proof Request.

`rerun` validates the previous lock, keeps its claim IDs and text, and writes a separate run. Browser assertions execute again. e2e may replay verified setup actions; the stored `cached` field describes setup replay, never permission to reuse an old verdict.

Named signoff updates the selected latest run and latest-report alias. It records the person, decision, optional reason, and timestamp while preserving the claim text and its human classification.

## Execution contexts

The author supplies completion text. Extraction turns it into explicit claims and candidate checks. Each browser assertion receives the claim, a fresh browser test context, and any generated setup; it does not receive the author's reasoning. The judge receives the claim, bounded interaction evidence, and the first and final recorded screenshots where available. Command judgment receives exit status and recognized numeric test summaries; raw command output is retained in the artifact. It is not given source files.

Browser checks operate on an already running HTTP(S) URL. The report records that URL and the checkout's commit, but their correspondence is not established. The availability request only proves that the URL answered before checking. It must not be presented as evidence of a UI claim.

Command checks use a disposable detached worktree of committed HEAD. Installed dependencies are copied from the original checkout into the disposable worktree. The runner limits inherited environment variables and captures bounded output, but a worktree is not a security sandbox. Command results do not cover uncommitted edits.

Human claims have no machine check. A person can sign off through the CLI. Use the CLI to record the named decision.

## Verdicts

| Recorded state | Verdict |
| --- | --- |
| Relevant completed check and evidence, judge probability at least 0.8 | `held` |
| Completed relevant check contradicts the claim, or judge probability at most 0.3 | `broken` |
| Subjective claim or an intermediate judge probability | `needs_human` |
| No completed relevant check, missing evidence, or unavailable judgment for an otherwise supporting check | `unverified` |

A recorded contradiction can remain broken when the judge is unavailable. Missing or refused model responses never become a low probability by default. Screenshots and output are evidence; a model assertion without relevant observations is insufficient.

## Artifact and terminal output

`packages/core/src/schema.ts` is the zod source of truth. Keep `proof-request.schema.json` synchronized. New artifacts use format 0.2; the reader also accepts historical 0.1 files. The full JSON output retains every claim and evidence field. `--summary` is the optional bounded view, with explicit omissions and a full artifact path. `show` inspects a saved report without a provider key. New runs generate no HTML and open no browser.

Provider selection is independent of the runner and consumer application. Extraction, classification and judgment use separate AI SDK calls with structured outputs. The browser runner creates a temporary configuration beside the target configuration, preserving app setup but supplying an independent agent and the selected model. It never writes credentials into that file. The legacy Decisions API client remains an internal compatibility path; the new CLI uses provider-independent structured calls. Recorded judge probabilities are model assessments, not calibrated accuracy estimates.

Report accounting contains only allowlisted metadata. OpenRouter's returned costs are retained; missing cost, failed requests and unmeasured browser costs remain unknown. A known subtotal cannot become a complete total. Retries are disabled for extraction and independent decision calls. See [report format](report-format.md) for the output and accounting contracts.
