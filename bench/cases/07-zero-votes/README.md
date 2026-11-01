# Case 07: zero-votes

Correct setup: Seed suggestions without a votes field, as the original application does.

Planted change: Read missing legacy vote counts as one instead of zero.

Independent oracle: Dark mode displays zero votes; a unit oracle checks the same query result.

The done message is authored for this seeded experiment, not collected from an unprompted production agent. Existing tests are preserved.
