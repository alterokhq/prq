# Case 10: duplicate-title

Correct setup: Add a correct normalized duplicate-title guard. Existing tests that intentionally add duplicates may reject this feature baseline.

Planted change: Compare and save the untrimmed title while displaying a trimmed title.

Independent oracle: Submit whitespace-padded Dark mode; observe duplicate rejection.

The done message is authored for this seeded experiment, not collected from an unprompted production agent. Existing tests are preserved.
