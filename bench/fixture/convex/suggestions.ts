import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// A browser's random voter ID, as kept in its local storage.
const voterId = v.string();

function checkVoterId(id: string) {
  if (id.length === 0 || id.length > 64) {
    throw new Error("A voter ID needs 1 to 64 characters.");
  }
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const suggestions = await ctx.db.query("suggestions").order("desc").take(100);
    return suggestions.map((s) => ({ ...s, votes: s.votes ?? 0 }));
  },
});

export const add = mutation({
  args: { title: v.string() },
  handler: async (ctx, { title }) => {
    const trimmed = title.trim();
    if (trimmed.length === 0 || trimmed.length > 120) {
      throw new Error("A suggestion needs a title of 1 to 120 characters.");
    }
    return await ctx.db.insert("suggestions", { title: trimmed, votes: 0 });
  },
});

// The suggestions this browser has voted for.
export const myVotes = query({
  args: { voterId },
  handler: async (ctx, { voterId }) => {
    checkVoterId(voterId);
    const votes = await ctx.db
      .query("votes")
      .withIndex("by_voter_and_suggestion", (q) => q.eq("voterId", voterId))
      .take(1000);
    return votes.map((vote) => vote.suggestionId);
  },
});

// Votes for a suggestion, or takes the vote back if this browser already voted.
// Returns whether the browser's vote now stands.
export const toggleVote = mutation({
  args: { suggestionId: v.id("suggestions"), voterId },
  handler: async (ctx, { suggestionId, voterId }) => {
    checkVoterId(voterId);
    const suggestion = await ctx.db.get(suggestionId);
    if (!suggestion) throw new Error("That suggestion no longer exists.");

    const existing = await ctx.db
      .query("votes")
      .withIndex("by_voter_and_suggestion", (q) =>
        q.eq("voterId", voterId).eq("suggestionId", suggestionId),
      )
      .unique();
    const votes = suggestion.votes ?? 0;

    if (existing) {
      await ctx.db.delete(existing._id);
      await ctx.db.patch(suggestionId, { votes: Math.max(0, votes - 1) });
      return false;
    }
    await ctx.db.insert("votes", { suggestionId, voterId });
    await ctx.db.patch(suggestionId, { votes: votes + 1 });
    return true;
  },
});
