import { internalMutation } from "./_generated/server";

const SUGGESTIONS = [
  "Dark mode",
  "Export to CSV",
  "Slack notifications",
  "Keyboard shortcuts",
  "Google Calendar sync",
  "Two-factor authentication",
  "Bulk edit",
  "Public API",
  "Mobile app",
  "Custom fields",
];

// Seeds the board once; a board that already has suggestions is left alone.
export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (await ctx.db.query("suggestions").first()) return;
    for (const title of SUGGESTIONS) {
      await ctx.db.insert("suggestions", { title });
    }
  },
});
