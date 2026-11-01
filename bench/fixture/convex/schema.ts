import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  suggestions: defineTable({
    title: v.string(),
    // Missing on suggestions created before voting existed; read as 0.
    votes: v.optional(v.number()),
  }),
  // One row per browser per suggestion it has voted for.
  votes: defineTable({
    suggestionId: v.id("suggestions"),
    voterId: v.string(),
  }).index("by_voter_and_suggestion", ["voterId", "suggestionId"]),
});
