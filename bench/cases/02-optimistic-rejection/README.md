# Case 02: optimistic-rejection

Correct setup: The Rejected vote item always rejects requests; the baseline changes no count.

Planted change: Keep an optimistic count after a rejected vote request.

Independent oracle: Vote for Rejected vote; after the rejection its count is still zero.

The done message is authored for this seeded experiment, not collected from an unprompted production agent. Existing tests are preserved.
