# Case 03: voter-isolation

Correct setup: A vote belonging to a different browser is seeded before the visit.

Planted change: Filter vote rows by the wrong field, returning another browser's vote.

Independent oracle: A fresh browser sees Dark mode as not voted.

The done message is authored for this seeded experiment, not collected from an unprompted production agent. Existing tests are preserved.
