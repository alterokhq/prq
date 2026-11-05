# Verify before opening a PR

The builder supplies its claims. PRQ runs checks, judges the evidence and writes a report. The builder fixes problems and reruns the same claims. A separate, offline gate checks the report before the workflow creates a PR.

This works without a particular agent, planning product or application framework. The workflow that creates the PR must call the gate and honor its exit code. `AGENTS.md` instructions alone cannot enforce it.

## Choose the project and commands

Run from the directory that owns the project's test configuration, or pass `--project service`. Explicit project paths are relative to the Git repository root, even when invoked from a subdirectory. A project must be inside that repository. Nested Git repositories are separate targets.

PRQ discovers verification scripts in the selected directory's `package.json`, inheriting a package manager from ancestor manifests. To choose the commands yourself, put `prq.config.json` in that directory:

```json
{
  "commands": ["python3 -m pytest", "go test ./..."]
}
```

These are execution examples; list commands that actually work in your project. Test-suite claims require [structured test evidence](test-evidence.md); plain pytest or Go output alone remains unverified. This explicit list replaces package-script discovery. A claim's `check.command` must match an entry exactly. Review commands as executable repository code. PRQ does not install tools or provide an operating-system sandbox.

Command checks run from the selected directory in a fresh checkout of the captured commit. Root and tracked workspace packages' installed `node_modules` are copied, and their internal symlinks point into the disposable checkout. Dependencies linked outside the repository are unsupported. Untracked build output, virtual environments, services and arbitrary environment variables are not copied. Prepare those through your commands or existing tooling. Missing setup leaves checks unverified.

For browser checks, install the [browser dependencies](user-guide.md#browser-setup) in the selected project and run `prq init --project service`. Its e2e configuration, generated tests and dependency lookup use that directory. Reports always live under the repository root's `.pr/`. Command-only projects can skip browser setup and `init`; add `.pr/` to `.gitignore` yourself.

## Submit explicit claims

After implementing and committing the change, the builder writes `.pr/claims.json`:

```json
{
  "format": "prq-claims/v1",
  "task": "Make search case-insensitive.",
  "source": "Search matches upper- and lowercase queries.",
  "unfinished": [],
  "claims": [
    {
      "id": "search-case",
      "text": "Search matches upper- and lowercase queries.",
      "kind": "command",
      "check": { "command": "python3 -m pytest" }
    }
  ]
}
```

Use unique, stable IDs and exact wording from `source`. PRQ rejects empty claim lists, duplicate IDs, non-verbatim text and supplied verdicts. `kind` is `command`, `browser` or `human`. Command checks use `check.command`; browser checks can use `check.path` and `check.setup`. The original task is optional. When supplied, it enables [task coverage and independent check selection](task-coverage.md), including two additional model requests. `unfinished` defaults to an empty array; list known unfinished work explicitly.

Explicit input skips claim extraction. With a nonempty task, PRQ extracts requirements separately and selects checks without seeing the builder's proposed routes or recipes. Without a task, the supplied routes are used. Command execution still uses the project's allowlist, and completed evidence receives independent judgment. Model credentials are required for verification. The source and task stay in the report. The task also goes to the coverage model; the evidence judge does not receive it or the builder's reasoning.

From the repository root:

```sh
prq --project service --claims-json .pr/claims.json --strict --summary
```

Use `--json` for the full report, or `--summary` for bounded agent context. Save its absolute `report` path. Do not rely on `.pr/last.json` when multiple tasks share a checkout. Keep each task's handoff separately too.

## Repair, rerun and hand off

Inspect the report, fix the code and commit the fix. Rerun the explicit report:

```sh
prq show <report> --json
prq fix --run <report>
prq rerun --run <report> --strict --summary
```

Replace `<report>` with the actual saved file. A rerun writes a fresh report, preserving claim IDs, wording, task, unfinished work and project selection. It clears earlier signoffs and collects new evidence. Save the new path for the next step. Changing project selection on a rerun is rejected.

When a claim requires judgment, an actual reviewer can record a decision:

```sh
prq signoff <claim-id> --run <report> --by "Reviewer name" --accept --reason "Reviewed the evidence"
```

An accepted human decision remains `needs_human`, with a named exception visible in JSON. It never becomes machine verification. Rejected decisions block the gate. PRQ records the supplied name; it does not authenticate the signer.

Before creating the PR, run:

```sh
prq gate <report> --claims-json .pr/claims.json --json
```

The gate makes no model calls and needs no API key. It requires the exact supplied claims and handoff, current commit, a clean working tree, no unfinished work, matching complete task coverage when a task is supplied, and every claim either held or explicitly accepted by a named reviewer. It reads claim rows rather than trusting summary counters. Ignored files, including `.pr/`, do not make the working tree dirty.

| Exit | Strict verification and gate |
| --- | --- |
| `0` | Claims are held or have a named human acceptance; no unfinished work. The gate also checked the handoff and source revision. |
| `1` | A broken claim or rejected human decision. |
| `2` | Unverified or unsigned claims, unfinished work, stale or mismatched input, or unavailable setup. |

The gate's JSON format is `prq-gate/v1`, with `ready`, `run_id`, `head`, `project`, `claim_hash` and `issues`. Startup errors use `prq-error/v1`. The consumer must stop PR creation on any nonzero exit. Default, non-strict verification keeps its earlier exit behavior, where unsigned human claims alone do not fail the command.

## What this does not establish

The gate checks a local report. It does not detect requirements the builder omitted, prove that tests cover a claim, authenticate artifacts or enforce GitHub policy. An editable JSON file is not a signed attestation. Review the original task, claims and evidence together.

Command evidence covers the recorded commit. Browser evidence covers the supplied running URL, whose source revision is not verified. A passing gate does not resolve that limitation. Keep existing CI and review checks while evaluating PRQ.

If unfinished work or task scope changes, create a new explicit handoff and run while retaining the earlier report. A rerun cannot silently clear unfinished work or weaken the original promises.

The optional Stop hook remains an informal completion-message check. It is separate from this explicit before-PR workflow.

Coverage is model-assessed and can miss requirements. A handoff without the original task cannot establish whether work was omitted. Consumers should supply the original task independently and keep CI/review enabled. See [coverage compatibility and repair](task-coverage.md).
