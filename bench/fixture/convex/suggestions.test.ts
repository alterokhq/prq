import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("a new suggestion appears on the board", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.suggestions.add, { title: "  Dark mode  " });
  const board = await t.query(api.suggestions.list, {});
  expect(board.map((s) => s.title)).toEqual(["Dark mode"]);
});

test("an empty title is refused", async () => {
  const t = convexTest(schema, modules);
  await expect(t.mutation(api.suggestions.add, { title: "   " })).rejects.toThrow();
});

test("the seed fills an empty board once", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.run, {});
  await t.mutation(internal.seed.run, {});
  expect(await t.query(api.suggestions.list, {})).toHaveLength(10);
});

async function boardWith(title: string) {
  const t = convexTest(schema, modules);
  const id = await t.mutation(api.suggestions.add, { title });
  const votesOn = async () =>
    (await t.query(api.suggestions.list, {})).find((s) => s._id === id)?.votes;
  return { t, id, votesOn };
}

test("every suggestion on the board shows its vote count", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.run, {});
  await t.mutation(api.suggestions.add, { title: "Dark mode" });
  const board = await t.query(api.suggestions.list, {});
  expect(board.map((s) => s.votes)).toEqual(new Array(11).fill(0));
});

test("a browser can vote with no account, and its votes are there on the next visit", async () => {
  const { t, id } = await boardWith("Dark mode");
  await t.mutation(api.suggestions.toggleVote, { suggestionId: id, voterId: "browser-a" });
  // A later visit from the same browser asks with the same voter ID.
  expect(await t.query(api.suggestions.myVotes, { voterId: "browser-a" })).toEqual([id]);
});

test("voting raises the count by one, and voting again takes it back", async () => {
  const { t, id, votesOn } = await boardWith("Dark mode");
  const vote = () =>
    t.mutation(api.suggestions.toggleVote, { suggestionId: id, voterId: "browser-a" });
  expect(await vote()).toBe(true);
  expect(await votesOn()).toBe(1);
  expect(await vote()).toBe(false);
  expect(await votesOn()).toBe(0);
});

test("a browser sees only the suggestions it voted for", async () => {
  const t = convexTest(schema, modules);
  const darkMode = await t.mutation(api.suggestions.add, { title: "Dark mode" });
  const csv = await t.mutation(api.suggestions.add, { title: "Export to CSV" });
  await t.mutation(api.suggestions.toggleVote, { suggestionId: darkMode, voterId: "browser-a" });
  await t.mutation(api.suggestions.toggleVote, { suggestionId: csv, voterId: "browser-b" });
  expect(await t.query(api.suggestions.myVotes, { voterId: "browser-a" })).toEqual([darkMode]);
});

test("votes are per browser, so another browser can vote too", async () => {
  const { t, id, votesOn } = await boardWith("Dark mode");
  for (const voterId of ["browser-a", "browser-b"]) {
    await t.mutation(api.suggestions.toggleVote, { suggestionId: id, voterId });
  }
  expect(await votesOn()).toBe(2);
});
