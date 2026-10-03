/**
 * When each question comes back - a Leitner schedule. A right answer moves a
 * question to the next box, whose interval is longer; a wrong one sends it back
 * to box 0. The gaps grow because recalling something just before you'd forget
 * it is what strengthens memory most; re-asking every day wastes the learner's
 * time on what they already know.
 *
 * Pure: takes "now" as a parameter (same reason token-bucket does - time-based
 * logic is only testable if the clock is an input).
 */

/** Days until the next review, per box. */
export const INTERVAL_DAYS = [1, 3, 7, 16, 35, 90];

const DAY_MS = 24 * 60 * 60 * 1000;

export interface QuestionState {
  box: number;
  dueAt: string;
}

export function nextState(current: QuestionState | undefined, correct: boolean, now: Date): QuestionState {
  // A question with no history is implicitly in box 0: it already waited its
  // first interval (a day after the unit was passed). So a right answer moves it
  // on to 3 days - it must never be rescheduled the same as a wrong one.
  const box = correct ? Math.min((current?.box ?? 0) + 1, INTERVAL_DAYS.length - 1) : 0;
  return { box, dueAt: new Date(now.getTime() + INTERVAL_DAYS[box] * DAY_MS).toISOString() };
}

/**
 * A question with no history is first due a day after its unit was passed, not
 * the moment it's passed: retrieval right after learning is too easy to help.
 */
export function isDue(state: QuestionState | undefined, unitCompletedAt: string, now: Date): boolean {
  return dueAtMs(state, unitCompletedAt) <= now.getTime();
}

/** When a question is next due (ms since epoch; NaN if the completion date is unparseable). */
export function dueAtMs(state: QuestionState | undefined, unitCompletedAt: string): number {
  return state ? Date.parse(state.dueAt) : Date.parse(unitCompletedAt) + INTERVAL_DAYS[0] * DAY_MS;
}
