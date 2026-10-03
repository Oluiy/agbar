import type { ReviewQuestion } from "../types.js";

/**
 * Forgiving about form, strict about content: case, surrounding whitespace,
 * backticks, a trailing full stop and repeated spaces don't matter; the words do.
 * "N+1" and "n+1." both match "n+1"; "n+2" doesn't. Anything else equally right
 * belongs in the question's `accept` list, where a lesson author can see it.
 */
export function normalize(text: string): string {
  // Trailing . or ! only after other text: "yes." is "yes", but an answer that IS
  // punctuation ("!" - how a Rust macro is called) must survive intact.
  return text
    .trim()
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .replace(/(?<=[^.!])[.!]+$/, "")
    .trim();
}

export function isCorrect(question: ReviewQuestion, answer: string): boolean {
  const given = normalize(answer);
  if (given === "") return false;
  return [question.answer, ...(question.accept ?? [])].some((ok) => normalize(ok) === given);
}
