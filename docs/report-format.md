# Report format

Each execution writes a separate directory under `.pr/runs/<run-id>/`. The report is static HTML; it needs no prq server.

| File | Contents |
| --- | --- |
| `proof-request.json` | Full claims, verdicts, evidence, source lock, subject and timing |
| `claims.lock.json` | Claim IDs and exact text locked before checks run |
| `index.html` | Inspectable report |
| `card.html` | Share-card HTML |
| `summary.md` | Markdown summary |
| `evidence/` | Browser screenshots and step evidence, when collected |

Command output is captured in the JSON evidence. Keep referenced evidence files beside the HTML when copying a run. `.pr/last.json` identifies the latest saved Proof Request used by `open`, `fix` and `rerun`.

The [JSON schema](../proof-request.schema.json) is the artifact contract; [schema.ts](../packages/core/src/schema.ts) is its zod source of truth. Stored verdicts are `held`, `broken`, `needs_human`, and `unverified`. Human signoff retains the person's name, decision, reason when supplied, and timestamp.

The claim lock is SHA-256 over the ordered claim IDs and exact text. Reruns preserve it and save fresh evidence in a new directory. The compact `--json` terminal response is a separate view that can shorten or omit rows; it is not the complete artifact.

To render a saved artifact as HTML on stdout:

```sh
npx @alterok/prq render proof-request.json > report.html
```

The renderer reads saved data without making network requests. Its copy and download controls operate locally; signoff and rerun controls prepare CLI commands.

The format itself, independent of prq, is defined in [SPEC.md](../SPEC.md).

[examples/search/proof-request.json](../examples/search/proof-request.json) is the recorded six-claim seeded search demo shown in the README: four held, one broken, one needs a human. The [example notes](../examples/search/README.md) distinguish the inconclusive browser assertion from the judge's broken verdict and describe the one path redaction. After the fix, a rerun with the same lock recorded five held and one needs a human. [fixtures/example.json](../fixtures/example.json) is illustrative test data; its screenshots are not included. For more measured evidence, see the [external experiment artifacts](../bench/external/README.md).
