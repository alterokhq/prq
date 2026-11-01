# Architecture

`prq` is a local CLI that turns a completion message into a saved Proof Request. It has no application server, database, hosted account, or GitHub integration.

```text
completion message
  → extract claims
  → lock exact claim IDs and text
  → classify browser / command / human
  → run browser and command checks
  → judge recorded evidence
  → save JSON, report, card, Markdown
  → fix prompt → fresh rerun with the same claim lock
```

## Package boundaries

| Package | Responsibility | Boundary |
| --- | --- | --- |
| `@prq/core` | Schema, extraction, lock, classification, Decisions client, judgment, fix prompt, Runner/Store contracts | No filesystem access, process spawning, or browser tooling |
| `@prq/runner-e2e` | Generated browser assertions, e2e execution, report parsing, evidence collection | Uses the target project's e2e installation and running application |
| `@prq/runner-shell` | Command checks and recorded exit/output | Fresh worktree of committed HEAD; copied installed dependencies |
| `@prq/render` | Static HTML report, 1200 × 630 card HTML, Markdown | Reads a Proof Request value; no network, models, or file access |
| `prq` | Input selection, orchestration, filesystem storage, terminal, commands | Connects the packages and writes `.pr/` |

The `@prq/*` packages are private workspaces bundled into the public `prq` CLI. They do not require separate package publication.

## Locked claims and separate runs

The canonical lock is SHA-256 over the ordered claim IDs and exact text. Capitalization, punctuation, whitespace, and ordering matter. The lock is saved before execution. Routing and setup can be refined without changing what the agent claimed.

A run ID is distinct from the claim lock. `.pr/runs/<run-id>/` contains its lock file, complete Proof Request, report, card, Markdown summary, and copied evidence. `.pr/last.json` stores the latest complete Proof Request.

`rerun` validates the previous lock, keeps its claim IDs and text, and writes a separate run. Browser assertions execute again. e2e may replay verified setup actions; the stored `cached` field describes setup replay, never permission to reuse an old verdict.

Named signoff updates the selected latest run and its rendered artifacts. It records the person, decision, optional reason, and timestamp while preserving the claim text and its human classification.

## Execution contexts

The author supplies completion text. Extraction turns it into explicit claims and candidate checks. Each browser assertion receives the claim, a fresh browser test context, and any generated setup; it does not receive the author's reasoning. The judge receives the claim, bounded interaction evidence, and the first and final recorded screenshots where available. Command judgment receives exit status and recognized numeric test summaries; raw command output is retained in the artifact. It is not given source files.

Browser checks operate on an already running HTTP(S) URL. The report records that URL and the checkout's commit, but their correspondence is not established. The availability request only proves that the URL answered before checking. It must not be presented as evidence of a UI claim.

Command checks use a disposable detached worktree of committed HEAD. Installed dependencies are copied from the original checkout into the disposable worktree. The runner limits inherited environment variables and captures bounded output, but a worktree is not a security sandbox. Command results do not cover uncommitted edits.

Human claims have no machine check. A person can sign off through the CLI. Static report controls prepare that command; they do not mutate files.

## Verdicts

| Recorded state | Verdict |
| --- | --- |
| Relevant completed check and evidence, judge probability at least 0.8 | `held` |
| Completed relevant check contradicts the claim, or judge probability at most 0.3 | `broken` |
| Subjective claim or an intermediate judge probability | `needs_human` |
| No completed relevant check, missing evidence, or unavailable judgment for an otherwise supporting check | `unverified` |

A recorded contradiction can remain broken when the judge is unavailable. Missing or refused model responses never become a low probability by default. Screenshots and output are evidence; a model assertion without relevant observations is insufficient.

## Artifact and rendering

`packages/core/src/schema.ts` is the zod source of truth. Keep `proof-request.schema.json` synchronized. The full artifact retains claim text and evidence. Agent-facing output is a compact view, so it can shorten or omit rows and point to the full file.

The report escapes source, claims, and evidence as untrusted text. Embedded JSON cannot close its script element. Screenshot references must be relative to the run. The renderer does not fetch fonts or remote images. Keep the evidence directory with the report when copying it elsewhere.

The report's copy and download controls operate locally. A clipboard fallback exposes selectable text when browser permissions are unavailable. Signoff commands quote names and reasons for the shell. No browser action starts a verifier or records a decision.
