import type { ProgressMap } from "../progress.js";
import type { ReviewQuestion, Unit } from "../types.js";
import { isCorrect } from "./answers.js";
import { questionKey, type ReviewStateMap } from "./reviewState.js";
import { dueAtMs, isDue, nextState } from "./schedule.js";

export interface DueQuestion {
  unit: Unit;
  question: ReviewQuestion;
}

/** Questions due now: only from passed units, only once their interval has elapsed. */
export function dueQuestions(units: Unit[], progress: ProgressMap, state: ReviewStateMap, now: Date): DueQuestion[] {
  return units.flatMap((unit) => {
    const completedAt = progress[unit.id]?.status === "done" ? progress[unit.id]?.completedAt : undefined;
    if (!completedAt) return [];
    return unit.reviewQuestions.filter((q) => isDue(state[questionKey(unit.id, q.id)], completedAt, now)).map((question) => ({ unit, question }));
  });
}

/**
 * What the learner has banked when nothing is due right now: how many units are
 * passed, and when the next question comes up. "Nothing due" on its own reads
 * as "broken" - saying *when* makes it a schedule.
 */
export function reviewOutlook(units: Unit[], progress: ProgressMap, state: ReviewStateMap): { passedUnits: number; nextDueAt?: number } {
  let passedUnits = 0;
  let nextDueAt: number | undefined;
  for (const unit of units) {
    const completedAt = progress[unit.id]?.status === "done" ? progress[unit.id]?.completedAt : undefined;
    if (!completedAt) continue;
    passedUnits++;
    for (const q of unit.reviewQuestions) {
      const at = dueAtMs(state[questionKey(unit.id, q.id)], completedAt);
      if (!Number.isNaN(at) && (nextDueAt === undefined || at < nextDueAt)) nextDueAt = at;
    }
  }
  return { passedUnits, nextDueAt };
}

export interface AnswerResult {
  item: DueQuestion;
  given: string;
  correct: boolean;
  nextDueAt: string;
}

/**
 * Asks each due question and reschedules it. `ask` is injected, so the session
 * is testable without a terminal and the CLI can use any prompt library - the
 * same dependency-inversion shape as Checker and StackAdapter. `onResult` lets
 * the caller show feedback immediately, while the question is still in mind.
 */
export async function runSession(
  items: DueQuestion[],
  state: ReviewStateMap,
  now: Date,
  ask: (item: DueQuestion) => Promise<string | undefined>,
  onResult: (result: AnswerResult) => void
): Promise<{ results: AnswerResult[]; state: ReviewStateMap; stoppedEarly: boolean }> {
  const next = { ...state };
  const results: AnswerResult[] = [];
  for (const item of items) {
    const given = await ask(item);
    // undefined = the learner quit (Ctrl+C / Esc): stop, keep what they did.
    if (given === undefined) return { results, state: next, stoppedEarly: true };
    const key = questionKey(item.unit.id, item.question.id);
    const correct = isCorrect(item.question, given);
    next[key] = nextState(next[key], correct, now);
    const result = { item, given, correct, nextDueAt: next[key].dueAt };
    results.push(result);
    onResult(result);
  }
  return { results, state: next, stoppedEarly: false };
}
