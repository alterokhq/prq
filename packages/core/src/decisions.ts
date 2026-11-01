import { z } from "zod";

export type InputPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string };
export type Question =
  | { type: "predicate"; name: string; instructions: string | InputPart[] }
  | {
      type: "choice";
      name: string;
      instructions: string | InputPart[];
      choices: { value: string; description: string }[];
    }
  | {
      type: "score";
      name: string;
      instructions: string | InputPart[];
      levels: { label: string; description: string }[];
    };
const probability = z.number().min(0).max(1);
export const Answer = z.discriminatedUnion("type", [
  z.object({ type: z.literal("predicate"), name: z.string(), probability }),
  z.object({
    type: z.literal("choice"),
    name: z.string(),
    choice: z.string(),
    confidence: probability,
  }),
  z.object({
    type: z.literal("score"),
    name: z.string(),
    score: z.number(),
    confidence: probability,
  }),
  z.object({ type: z.literal("refusal"), name: z.string() }),
]);
export type Answer = z.infer<typeof Answer>;
export interface DecisionsOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function decide(
  input: string | { role: "user"; content: InputPart[] }[],
  questions: Question[],
  opts: DecisionsOptions = {},
): Promise<Answer[]> {
  if (!questions.length) return [];
  if (questions.length > 400) throw new Error("A proof request supports at most 400 claims");
  if (new Set(questions.map((q) => q.name)).size !== questions.length)
    throw new Error("Question names must be unique");
  if (!opts.apiKey) throw new Error("OPENAI_API_KEY is not set");
  const res = await (opts.fetchImpl ?? fetch)(
    `${opts.baseUrl ?? "https://api.openai.com"}/v1/decisions`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: opts.model ?? "gpt-6-luna", input, questions }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    },
  );
  if (!res.ok) throw new Error(`Decisions request unavailable (HTTP ${res.status})`);
  const parsed = z.object({ answers: z.array(Answer) }).safeParse(await res.json());
  if (!parsed.success) throw new Error("Decisions returned an invalid answer format");
  const body = parsed.data;
  const requested = new Set(questions.map((q) => q.name));
  const seen = new Set<string>();
  for (const answer of body.answers) {
    if (!requested.has(answer.name) || seen.has(answer.name))
      throw new Error("Decisions returned unmatched or duplicate answers");
    seen.add(answer.name);
  }
  return body.answers;
}
