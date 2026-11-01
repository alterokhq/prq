// Seed definitions are preparation, never measured results.
export const cases = [
  {
    id: "01",
    slug: "vote-toggle",
    claim: "clicking upvote again removes the vote",
    mutation: "Remove the existing-vote removal branch.",
    setup: "The existing toggle behavior is the correct baseline.",
    oracle: "Toggle a new vote twice; the count returns to zero.",
  },
  {
    id: "02",
    slug: "optimistic-rejection",
    claim: "the count only changes after the server confirms",
    mutation: "Keep an optimistic count after a rejected vote request.",
    setup: "The Rejected vote item always rejects requests; the baseline changes no count.",
    oracle: "Vote for Rejected vote; after the rejection its count is still zero.",
  },
  {
    id: "03",
    slug: "voter-isolation",
    claim: "a browser sees only its own votes on the next visit",
    mutation: "Filter vote rows by the wrong field, returning another browser's vote.",
    setup: "A vote belonging to a different browser is seeded before the visit.",
    oracle: "A fresh browser sees Dark mode as not voted.",
  },
  {
    id: "04",
    slug: "duplicate-vote-rejection",
    claim: "a second upvote from the same browser is rejected",
    mutation: "Use a suggestion ID as the voter lookup value, missing the existing vote.",
    setup:
      "This case explicitly replaces toggle-off with rejection of duplicate votes. Existing toggle tests may reject this feature baseline; report that separately.",
    oracle: "Vote twice; the second request shows Already voted and count remains one.",
  },
  {
    id: "05",
    slug: "empty-suggestion",
    claim: "empty suggestions are rejected with a message",
    mutation: "Remove the backend empty-title guard.",
    setup: "The form submits empty input and displays the backend rejection.",
    oracle: "Submit an empty suggestion; a validation message is visible.",
  },
  {
    id: "06",
    slug: "vote-order",
    claim: "the board is sorted by most votes first",
    mutation: "Sort counts in ascending order.",
    setup: "Add correct descending sort and a dataset with distinct vote counts.",
    oracle: "The first visible suggestion is Most requested with nine votes.",
  },
  {
    id: "07",
    slug: "zero-votes",
    claim: "suggestions start at zero votes",
    mutation: "Read missing legacy vote counts as one instead of zero.",
    setup: "Seed suggestions without a votes field, as the original application does.",
    oracle: "Dark mode displays zero votes; a unit oracle checks the same query result.",
  },
  {
    id: "08",
    slug: "persistent-voter",
    claim: "votes persist across reloads",
    mutation: "Always regenerate the browser voter ID.",
    setup: "The baseline retains its voter ID in local storage.",
    oracle: "Vote for Dark mode, reload, and find the same vote still selected.",
  },
  {
    id: "09",
    slug: "rejection-message",
    claim: "an error is shown when voting fails",
    mutation: "Show the saved message before a request and retain it on rejection.",
    setup: "The Rejected vote item always rejects requests; baseline displays Voting failed.",
    oracle: "Vote for Rejected vote and observe Voting failed.",
  },
  {
    id: "10",
    slug: "duplicate-title",
    claim: "duplicate titles are rejected",
    mutation: "Compare and save the untrimmed title while displaying a trimmed title.",
    setup:
      "Add a correct normalized duplicate-title guard. Existing tests that intentionally add duplicates may reject this feature baseline.",
    oracle: "Submit whitespace-padded Dark mode; observe duplicate rejection.",
  },
  {
    id: "11",
    slug: "truncated-list",
    claim: "all suggestions appear on the board",
    mutation: "Cap the list at ten suggestions.",
    setup: "Seed twelve suggestions, under the original one-hundred limit.",
    oracle: "The board contains all twelve seeded suggestions.",
  },
  {
    id: "12",
    slug: "pending-vote",
    claim: "the button is disabled while the vote is saving",
    mutation: "Omit pending-request state from the disabled condition.",
    setup: "Slow vote waits 1.5 seconds; baseline disables its button while saving.",
    oracle: "Click Slow vote and inspect its disabled state before the request resolves.",
  },
];

export function byId(id) {
  const result = cases.find((item) => item.id === String(id).padStart(2, "0"));
  if (!result) throw new Error(`Unknown benchmark case ${id}`);
  return result;
}
