# Case 12: pending-vote

Correct setup: Slow vote waits 1.5 seconds; baseline disables its button while saving.

Planted change: Omit pending-request state from the disabled condition.

Independent oracle: Click Slow vote and inspect its disabled state before the request resolves.

The done message is authored for this seeded experiment, not collected from an unprompted production agent. Existing tests are preserved.
