# Case 05: empty-suggestion

Correct setup: The form submits empty input and displays the backend rejection.

Planted change: Remove the backend empty-title guard.

Independent oracle: Submit an empty suggestion; a validation message is visible.

The done message is authored for this seeded experiment, not collected from an unprompted production agent. Existing tests are preserved.
