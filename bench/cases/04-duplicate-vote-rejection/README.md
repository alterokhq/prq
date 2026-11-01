# Case 04: duplicate-vote-rejection

Correct setup: This case explicitly replaces toggle-off with rejection of duplicate votes. Existing toggle tests may reject this feature baseline; report that separately.

Planted change: Use a suggestion ID as the voter lookup value, missing the existing vote.

Independent oracle: Vote twice; the second request shows Already voted and count remains one.

The done message is authored for this seeded experiment, not collected from an unprompted production agent. Existing tests are preserved.
