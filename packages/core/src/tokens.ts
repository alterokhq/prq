import { Tiktoken } from "js-tiktoken/lite";
import o200kBase from "js-tiktoken/ranks/o200k_base";

let tokenizer: Tiktoken | undefined;
function encoding(): Tiktoken {
  tokenizer ??= new Tiktoken(o200kBase);
  return tokenizer;
}
/** Agent-facing output uses the documented o200k_base encoding and a 300-token ceiling. */
export function tokenCount(text: string): number {
  return encoding().encode(text, [], []).length;
}
export function tokenExcerpt(text: string, limit: number): string {
  const tokens = encoding().encode(text, [], []).slice(0, limit);
  let result = encoding().decode(tokens);
  while (tokenCount(result) > limit) {
    tokens.pop();
    result = encoding().decode(tokens);
  }
  return result;
}
