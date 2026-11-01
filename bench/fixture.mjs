import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

function replaceOnce(text, before, after) {
  if (text.split(before).length !== 2)
    throw new Error(`Fixture source changed; expected exactly one anchor: ${before.slice(0, 80)}`);
  return text.replace(before, after);
}

export async function mutate(root, seed) {
  const path = join(
    root,
    seed.id === "08"
      ? "app/voter.ts"
      : ["02", "09", "12"].includes(seed.id)
        ? "app/page.tsx"
        : "convex/suggestions.ts",
  );
  let text = await readFile(path, "utf8");
  switch (seed.id) {
    case "01":
      text = replaceOnce(text, "if (existing) {", "if (false && existing) {");
      break;
    case "02":
      text = replaceOnce(
        text,
        "setPending((state) => ({ ...state, [id]: true }));",
        "setPending((state) => ({ ...state, [id]: true }));\n    setCounts((state) => ({ ...state, [id]: count + 1 }));",
      );
      break;
    case "03":
      text = replaceOnce(
        text,
        '.withIndex("by_voter_and_suggestion", (q) => q.eq("voterId", voterId))',
        '.filter((q) => q.neq(q.field("suggestionId"), voterId))',
      );
      break;
    case "04":
      text = replaceOnce(
        text,
        'q.eq("voterId", voterId).eq("suggestionId", suggestionId)',
        'q.eq("voterId", suggestionId).eq("suggestionId", suggestionId)',
      );
      break;
    case "05":
      text = replaceOnce(
        text,
        "trimmed.length === 0 || trimmed.length > 120",
        "trimmed.length > 120",
      );
      break;
    case "06":
      text = replaceOnce(
        text,
        ".sort((a, b) => b.votes - a.votes)",
        ".sort((a, b) => a.votes - b.votes)",
      );
      break;
    case "07":
      text = replaceOnce(text, "votes: s.votes ?? 0", "votes: s.votes ?? 1");
      break;
    case "08":
      text = replaceOnce(
        text,
        "if (saved) return saved;",
        "// Each visit receives a fresh browser identity.",
      );
      break;
    case "09":
      text = replaceOnce(
        text,
        'setMessage("");\n    try {\n      await vote',
        'setMessage("Vote saved.");\n    try {\n      await vote',
      );
      text = replaceOnce(
        text,
        'setMessage("Voting failed. Please try again.");',
        'setMessage("Vote saved.");',
      );
      break;
    case "10":
      text = replaceOnce(
        text,
        '.filter((q) => q.eq(q.field("title"), trimmed))',
        '.filter((q) => q.eq(q.field("title"), title))',
      );
      text = replaceOnce(text, "{ title: trimmed, votes: 0 }", "{ title, votes: 0 }");
      break;
    case "11":
      text = replaceOnce(text, '.order("desc").take(100)', '.order("desc").take(10)');
      break;
    case "12":
      text = replaceOnce(
        text,
        "disabled={!voterId || pending[suggestion._id] === true}",
        "disabled={!voterId}",
      );
      break;
    default:
      throw new Error("Missing mutation");
  }
  await writeFile(path, text);
}

export async function prepareBaseline(root, seed) {
  const suggestionsPath = join(root, "convex/suggestions.ts");
  let suggestions = await readFile(suggestionsPath, "utf8");
  if (seed.id === "04")
    suggestions = replaceOnce(
      suggestions,
      "if (existing) {\n      await ctx.db.delete(existing._id);\n      await ctx.db.patch(suggestionId, { votes: Math.max(0, votes - 1) });\n      return false;\n    }",
      'if (existing) {\n      throw new Error("Already voted.");\n    }',
    );
  if (seed.id === "06")
    suggestions = replaceOnce(
      suggestions,
      "return suggestions.map((s) => ({ ...s, votes: s.votes ?? 0 }));",
      "return suggestions.map((s) => ({ ...s, votes: s.votes ?? 0 })).sort((a, b) => b.votes - a.votes);",
    );
  if (seed.id === "10")
    suggestions = replaceOnce(
      suggestions,
      'return await ctx.db.insert("suggestions", { title: trimmed, votes: 0 });',
      'const duplicate = await ctx.db.query("suggestions").filter((q) => q.eq(q.field("title"), trimmed)).first();\n    if (duplicate) throw new Error("Duplicate title.");\n    return await ctx.db.insert("suggestions", { title: trimmed, votes: 0 });',
    );
  await writeFile(suggestionsPath, suggestions);
  await writeFile(join(root, "app/page.tsx"), page(seed));
  await writeFile(join(root, "convex/bench.ts"), backend(seed));
  await mkdir(join(root, "bench"), { recursive: true });
  await writeFile(join(root, "bench/done.md"), `${seed.claim}\n`);
  await writeFile(
    join(root, "bench/README.md"),
    `# Case ${seed.id}: ${seed.slug}\n\nCorrect setup: ${seed.setup}\n\nPlanted change: ${seed.mutation}\n\nIndependent oracle: ${seed.oracle}\n\nThe done message is authored for this seeded experiment, not collected from an unprompted production agent. Existing tests are preserved.\n`,
  );
  await writeFile(join(root, "convex/prq-author.test.ts"), authorTest(seed));
  if (seed.id === "07") await writeFile(join(root, "convex/prq-oracle.test.ts"), zeroOracle);
  await writeFile(join(root, "e2e.config.ts"), config);
  // Project-local generated config avoids inheriting production deployment selection.
  await writeFile(
    join(root, "convex/tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ESNext",
          lib: ["ES2021", "DOM"],
          strict: true,
          module: "ESNext",
          moduleResolution: "Bundler",
          allowJs: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ["./**/*"],
        exclude: ["_generated"],
      },
      null,
      2,
    ) + "\n",
  );
  const ignore = await readFile(join(root, ".gitignore"), "utf8");
  await writeFile(
    join(root, ".gitignore"),
    `${ignore}\n.pr/\n.e2e/\n.convex/\nbench/runtime/\ntests/prq-*.e2e.ts\n`,
  );
}

const config = `import { openai } from '@ai-sdk/openai';
import { web } from '@e2e-dev/web';
export default {
  targets: [{ engine: web({ browser: 'chromium' }), app: { url: process.env.PRQ_APP_URL } }],
  agents: { default: { model: openai('gpt-6.1-sol'), judgmentTimeout: 60000 } },
  reporters: ['list', 'markdown'], cache: { mode: 'read-write', dir: '.e2e/cache' },
};\n`;

function page(seed) {
  return `"use client";
import { useAction, useMutation, useQuery } from "convex/react";
import { type FormEvent, useEffect, useState } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { getVoterId } from "./voter";
export default function Board() {
  const suggestions = useQuery(api.suggestions.list);
  const add = useMutation(api.suggestions.add);
  const vote = useAction(api.bench.vote);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [voterId, setVoterId] = useState<string>();
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => setVoterId(getVoterId(localStorage)), []);
  const myVotes = useQuery(api.suggestions.myVotes, voterId ? { voterId } : "skip");
  const voted = new Set<string>(myVotes ?? []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    try { await add({ title }); setTitle(""); setMessage("Suggestion saved."); }
    catch { setMessage(${JSON.stringify(seed.id === "10" ? "Duplicate titles are rejected." : "A suggestion needs a title of 1 to 120 characters.")}); }
  }
  async function castVote(id: Id<"suggestions">, count: number) {
    if (!voterId) return;
    setPending((state) => ({ ...state, [id]: true }));
    setMessage("");
    try {
      await vote({ suggestionId: id, voterId });
      setMessage("Vote saved.");
    } catch {
      ${seed.id === "04" ? 'setMessage("Already voted. A second vote is rejected.");' : 'setMessage("Voting failed. Please try again.");'}
    } finally { setPending((state) => ({ ...state, [id]: false })); }
  }
  return <main><h1>Feedback board</h1><p className="muted">Tell us what to build next.</p>
    <p>Benchmark fixture. Voting on Rejected vote produces a rejected request. Slow vote takes 1.5 seconds. The board has 12 seeded suggestions.</p>
    <form onSubmit={submit}><input aria-label="Suggest a feature" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Suggest a feature" maxLength={120}/><button type="submit">Suggest</button></form>
    <p role="status">{message}</p>
    {suggestions === undefined ? <p>Loading…</p> : <ul>{suggestions.map((suggestion) => <li key={suggestion._id} data-title={suggestion.title.trim()}>
      <button type="button" className="vote" aria-pressed={voted.has(suggestion._id)} aria-label={String(counts[suggestion._id] ?? suggestion.votes) + " votes"} disabled={!voterId || pending[suggestion._id] === true} onClick={() => castVote(suggestion._id, suggestion.votes)}><span aria-hidden="true">▲</span><span>{counts[suggestion._id] ?? suggestion.votes}</span></button><span>{suggestion.title.trim()}</span>
    </li>)}</ul>}
  </main>;
}\n`;
}

function backend(seed) {
  return `import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { api, internal } from "./_generated/api";
export const title = internalQuery({args:{id:v.id("suggestions")},handler:async(ctx,{id}) => (await ctx.db.get(id))?.title ?? ""});
export const vote = action({args:{suggestionId:v.id("suggestions"),voterId:v.string()},handler:async(ctx,args):Promise<boolean> => {
  const title = await ctx.runQuery(internal.bench.title,{id:args.suggestionId});
  if(title === "Rejected vote") throw new Error("Deliberate benchmark request rejection.");
  if(title === "Slow vote") await new Promise(resolve => setTimeout(resolve,1500));
  return await ctx.runMutation(api.suggestions.toggleVote,args);
}});
export const reset = internalMutation({args:{},handler:async(ctx) => {
  for(const table of ["votes","suggestions"] as const) for(const row of await ctx.db.query(table).collect()) await ctx.db.delete(row._id);
  const titles = ["Dark mode","Export to CSV","Mobile app","Custom fields","Most requested","Slow vote","Rejected vote","Public API","Bulk edit","Keyboard shortcuts","Calendar sync","Last suggestion"];
  for(const [index,title] of titles.entries()) {
    const id = await ctx.db.insert("suggestions", ${seed.id === "06" ? "{title,votes:index===4?9:index===1?3:0}" : "{title}"});
    ${seed.id === "03" ? 'if(index===0){await ctx.db.insert("votes",{suggestionId:id,voterId:"another-browser"});await ctx.db.patch(id,{votes:1});}' : ""}
  }
}});\n`;
}

function authorTest(seed) {
  if (seed.id === "08")
    return `import {expect,test} from "vitest";\nimport {getVoterId} from "../app/voter";\ntest("a new browser receives an identity",()=>{const values=new Map<string,string>();const id=getVoterId({getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value);}});expect(id.length).toBeGreaterThan(0);});\n`;
  return `import {convexTest} from "convex-test";
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
});\n`;
}

const zeroOracle = `import {convexTest} from "convex-test";
import {expect,test} from "vitest";
import {api} from "./_generated/api";
import schema from "./schema";
const modules=import.meta.glob("./**/*.ts");
test("a seeded suggestion without a votes field reads as zero",async()=>{
  const t=convexTest(schema,modules);
  await t.run(async ctx=>{await ctx.db.insert("suggestions",{title:"Legacy suggestion"});});
  expect((await t.query(api.suggestions.list,{}))[0]?.votes).toBe(0);
});\n`;
