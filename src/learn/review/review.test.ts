import { describe, expect, it } from "vitest";
import { loadUnits } from "../loader.js";
import { SUPPORTED_LEARN_LANGUAGES } from "../learnCommand.js";
import type { ProgressMap } from "../progress.js";
import type { ReviewQuestion, Unit } from "../types.js";
import { isCorrect } from "./answers.js";
import { INTERVAL_DAYS, isDue, nextState } from "./schedule.js";
import { nothingDueMessage, runReview } from "./reviewCommand.js";
import { dueQuestions, reviewOutlook, runSession } from "./session.js";

const now = new Date("2026-03-01T00:00:00Z");
const days = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString();
const q = (over: Partial<ReviewQuestion> = {}): ReviewQuestion => ({ id: "q1", question: "?", answer: "n+1", ...over });
const unit = (questions: ReviewQuestion[]): Unit => ({ id: "u1", title: "U", reviewQuestions: questions, challenges: [] }) as unknown as Unit;
const passed: ProgressMap = { u1: { status: "done", attempts: 1, passedChallengeIds: ["c"], completedAt: "2026-02-20T00:00:00Z" } };

describe("schedule", () => {
  it("each right answer moves a question to a longer interval, capped at the last box", () => {
    // First review, answered right: already waited 1 day, so next is 3 days - never the same as a miss.
    let s = nextState(undefined, true, now);
    expect(s).toEqual({ box: 1, dueAt: days(INTERVAL_DAYS[1]) });
    expect(s.dueAt).not.toBe(nextState(undefined, false, now).dueAt);
    s = nextState(s, true, now);
    expect(s.dueAt).toBe(days(INTERVAL_DAYS[2]));
    for (let i = 0; i < 10; i++) s = nextState(s, true, now);
    expect(s.box).toBe(INTERVAL_DAYS.length - 1);
  });

  it("a wrong answer sends it back to tomorrow, however far along it was", () => {
    expect(nextState({ box: 4, dueAt: days(0) }, false, now)).toEqual({ box: 0, dueAt: days(1) });
  });

  it("a new question is first due a day after the unit was passed, not immediately", () => {
    expect(isDue(undefined, now.toISOString(), now)).toBe(false);
    expect(isDue(undefined, days(-1), now)).toBe(true);
  });

  it("an unparseable completion date never makes anything due, and doesn't throw", () => {
    expect(isDue(undefined, "not-a-date", now)).toBe(false);
  });
});

describe("answers", () => {
  it("ignores case, backticks, spacing and a trailing full stop - not the content", () => {
    expect(isCorrect(q(), " `N+1`. ")).toBe(true);
    expect(isCorrect(q(), "n+2")).toBe(false);
    expect(isCorrect(q(), "")).toBe(false);
  });

  it("an answer that is itself punctuation still matches", () => {
    expect(isCorrect(q({ answer: "!" }), "!")).toBe(true);
    expect(isCorrect(q({ answer: "|" }), "|")).toBe(true);
  });

  it("every shipped question's own answer and accepted spellings are marked correct", () => {
    for (const language of SUPPORTED_LEARN_LANGUAGES) {
      for (const u of loadUnits(language)) {
        for (const question of u.reviewQuestions) {
          for (const ok of [question.answer, ...(question.accept ?? [])]) {
            expect(isCorrect(question, ok), `${u.id}#${question.id}: '${ok}'`).toBe(true);
          }
        }
      }
    }
  });

  it("accepts listed alternatives", () => {
    expect(isCorrect(q({ accept: ["n plus one"] }), "N plus one")).toBe(true);
  });
});

describe("session", () => {
  it("asks only questions from passed units whose interval has elapsed", () => {
    const u = unit([q(), q({ id: "q2" })]);
    const state = { "u1#q2": { box: 2, dueAt: days(5) } };
    expect(dueQuestions([u], passed, state, now).map((d) => d.question.id)).toEqual(["q1"]);
    expect(dueQuestions([u], {}, {}, now)).toEqual([]);
  });

  it("reschedules every answer, and stopping early keeps what was answered", async () => {
    const u = unit([q(), q({ id: "q2" })]);
    const due = dueQuestions([u], passed, {}, now);
    const answers = ["n+1", undefined];
    const seen: boolean[] = [];
    const out = await runSession(
      due,
      {},
      now,
      async () => answers.shift(),
      (r) => seen.push(r.correct)
    );
    expect(out.stoppedEarly).toBe(true);
    expect(seen).toEqual([true]);
    expect(Object.keys(out.state)).toEqual(["u1#q1"]);
  });
});

describe("when nothing is due", () => {
  it("reports passed units and the next due time, so an empty queue doesn't look broken", () => {
    const u = unit([q(), q({ id: "q2" })]);
    const state = { "u1#q1": { box: 1, dueAt: days(3) }, "u1#q2": { box: 2, dueAt: days(7) } };
    expect(reviewOutlook([u], passed, state)).toEqual({ passedUnits: 1, nextDueAt: Date.parse(days(3)) });
    expect(reviewOutlook([u], {}, {})).toEqual({ passedUnits: 0, nextDueAt: undefined });
  });

  it("tells someone who hasn't passed anything where to start, not just 'nothing due'", () => {
    expect(nothingDueMessage(0, undefined)).toMatch(/haven't passed one[\s\S]*tracks first-steps/);
    expect(nothingDueMessage(2, Date.parse(days(3)))).toMatch(/passed 2 lessons\. Next question due/);
  });
});

describe("without a terminal", () => {
  it("refuses with a clear message and exit code 1, instead of losing the answers", async () => {
    const isTTY = process.stdin.isTTY;
    const exitCode = process.exitCode;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    const errors: string[] = [];
    const original = console.error;
    console.error = (m: string) => errors.push(m);
    try {
      await runReview(["yaml"]);
      expect(process.exitCode).toBe(1);
      expect(errors.join("")).toMatch(/interactive quiz - run it in a terminal/);
    } finally {
      console.error = original;
      Object.defineProperty(process.stdin, "isTTY", { value: isTTY, configurable: true });
      process.exitCode = exitCode;
    }
  });
});

describe("shipped content", () => {
  it("every lesson unit has at least two review questions - recall is the point", () => {
    for (const language of SUPPORTED_LEARN_LANGUAGES) {
      for (const u of loadUnits(language)) {
        expect(u.reviewQuestions.length, `${language}/${u.id}`).toBeGreaterThanOrEqual(2);
      }
    }
  });
});
