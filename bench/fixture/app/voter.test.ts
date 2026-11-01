import { expect, test } from "vitest";
import { getVoterId } from "./voter";

function browserStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

test("a browser keeps the same voter ID from one visit to the next", () => {
  const storage = browserStorage();
  expect(getVoterId(storage)).toBe(getVoterId(storage));
});

test("another browser, or one with cleared storage, gets a new voter ID", () => {
  expect(getVoterId(browserStorage())).not.toBe(getVoterId(browserStorage()));
});
