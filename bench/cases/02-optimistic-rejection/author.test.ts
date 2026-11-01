import {convexTest} from "convex-test";
import {expect,test} from "vitest";
import {api} from "./_generated/api";
import schema from "./schema";
const modules=import.meta.glob("./**/*.ts");
test("a suggestion can be added and receive its first vote",async()=>{
  const t=convexTest(schema,modules);
  const id=await t.mutation(api.suggestions.add,{title:"New feature"});
  await t.mutation(api.suggestions.toggleVote,{suggestionId:id,voterId:"author-browser"});
  const board=await t.query(api.suggestions.list,{});
  expect(board.find(row=>row._id===id)?.title).toBe("New feature");
  expect(board.find(row=>row._id===id)?.votes).toBe(1);
});
