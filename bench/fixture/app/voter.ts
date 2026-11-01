const KEY = "feedback-board:voter-id";

// This browser's voter ID: made once, then kept in storage so its votes
// are still its own on the next visit.
export function getVoterId(storage: Pick<Storage, "getItem" | "setItem">): string {
  const saved = storage.getItem(KEY);
  if (saved) return saved;
  const id = crypto.randomUUID();
  storage.setItem(KEY, id);
  return id;
}
