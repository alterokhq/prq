"use client";

import { useMutation, useQuery } from "convex/react";
import { type FormEvent, useEffect, useState } from "react";
import { api } from "../convex/_generated/api";
import { getVoterId } from "./voter";

export default function Board() {
  const suggestions = useQuery(api.suggestions.list);
  const add = useMutation(api.suggestions.add);
  const toggleVote = useMutation(api.suggestions.toggleVote);
  const [title, setTitle] = useState("");

  // Local storage only exists in the browser, so the ID is read after mount.
  const [voterId, setVoterId] = useState<string>();
  useEffect(() => setVoterId(getVoterId(localStorage)), []);
  const myVotes = useQuery(api.suggestions.myVotes, voterId ? { voterId } : "skip");
  const voted = new Set<string>(myVotes ?? []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    await add({ title });
    setTitle("");
  }

  return (
    <main>
      <h1>Feedback board</h1>
      <p className="muted">Tell us what to build next.</p>

      <form onSubmit={submit}>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Suggest a feature"
          maxLength={120}
        />
        <button type="submit">Suggest</button>
      </form>

      {suggestions === undefined ? (
        <p className="muted">Loading…</p>
      ) : (
        <ul>
          {suggestions.map((suggestion) => {
            const hasVoted = voted.has(suggestion._id);
            return (
              <li key={suggestion._id}>
                <button
                  type="button"
                  className="vote"
                  aria-pressed={hasVoted}
                  aria-label={`${suggestion.votes} votes`}
                  title={hasVoted ? "Take back your vote" : "Vote for this"}
                  disabled={!voterId}
                  onClick={() => voterId && toggleVote({ suggestionId: suggestion._id, voterId })}
                >
                  <span aria-hidden="true">▲</span>
                  <span>{suggestion.votes}</span>
                </button>
                <span>{suggestion.title}</span>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
