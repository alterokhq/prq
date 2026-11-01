# Recorded search demo

This is a real saved run against a local feedback-board application with a deliberately planted case-sensitivity bug. The completion message was part of that demonstration, not an independently sampled agent mistake. The captured command evidence records 14 tests completing with exit code 0.

The run recorded four held, one broken and one needs a human. For claim `c3`, the browser tester returned `ASSERTION_INCONCLUSIVE`: its final view alone did not establish a case comparison. The step log records a visible `Custom fields` item before typing `CUSTOM FIELDS`, followed by no matches. The separate Decisions judge returned probability 0, and prq recorded `broken`. Both the tester observation and judge result are preserved; do not describe this as a conclusive browser assertion.

- [Saved Proof Request](proof-request.json)
- [Before the search](evidence/c3-0/0-001-before-setup.png)
- [After the search](evidence/c3-0/1-002-assert.png)
- [Browser trace](evidence/c3-0/trace.md)

The claim lock is `sha256:375072880db0a444bc8ef65f9006a64812402d40b7c0e83f4c592e09cbc74174`. Source text, exact claims, verdicts and probabilities are unchanged. The shell output's machine-specific temporary checkout path was replaced with `<temporary-checkout>` for publication. Screenshot and trace files were copied from the original run. The report records a local URL and commit but does not establish that the served application was built from that commit.

The README image replays this saved run through the actual CLI terminal renderer. It preserves the recorded claims, observations and timing. It is an ANSI output rendering, not a native terminal screenshot or a new verification run. Relative `.pr/e2e/` and `attempt-1/` locations inside the historical trace describe the original runner layout; use the portable screenshot links above or the JSON's `evidence[].path` fields in this directory.
