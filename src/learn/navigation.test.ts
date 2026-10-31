import { describe, expect, it } from "vitest";
import { nextStepAfterPass, pickChallenge, resolveLesson } from "./navigation.js";
import type { ProgressMap } from "./progress.js";
import type { Unit } from "./types.js";

const unit = (id: string, chapterRef: number, title: string, challengeIds: string[]): Unit =>
  ({ id, chapterRef, title, challenges: challengeIds.map((c) => ({ id: c })), reviewQuestions: [] }) as unknown as Unit;
const units = [
  unit("01-text-traps", 1, "Text Traps", ["predict-text", "fix-same-username"]),
  unit("02-number-traps", 2, "Number Traps: Money", ["predict-numbers"]),
  unit("03-time-traps", 3, "Time Traps", ["predict-time"]),
];
const done = (_unitId: string, passed: string[]): ProgressMap[string] => ({
  status: "done",
  attempts: 1,
  passedChallengeIds: passed,
  completedAt: "2026-01-01",
});

describe("resolveLesson - no need to type the full id", () => {
  it("accepts the full id, the number, a zero-padded number, an id prefix, or a unique word", () => {
    expect(resolveLesson(units, "02-number-traps")?.id).toBe("02-number-traps");
    expect(resolveLesson(units, "2")?.id).toBe("02-number-traps");
    expect(resolveLesson(units, "02")?.id).toBe("02-number-traps");
    expect(resolveLesson(units, "03-ti")?.id).toBe("03-time-traps");
    expect(resolveLesson(units, "money")?.id).toBe("02-number-traps");
  });

  it("refuses to guess when several lessons fit, or none does", () => {
    expect(resolveLesson(units, "traps")).toBeUndefined();
    expect(resolveLesson(units, "99")).toBeUndefined();
  });
});

describe("pickChallenge - what plain `agbar submit` grades", () => {
  it("the one named, else the first one not yet passed", () => {
    const u = units[0];
    expect(pickChallenge(u, {}, "fix-same-username")?.id).toBe("fix-same-username");
    expect(pickChallenge(u, {})?.id).toBe("predict-text");
    expect(pickChallenge(u, { [u.id]: { status: "in_progress", attempts: 1, passedChallengeIds: ["predict-text"] } })?.id).toBe("fix-same-username");
    expect(pickChallenge(u, {}, "nope")).toBeUndefined();
  });
});

describe("nextStepAfterPass - every pass ends on a next step", () => {
  it("the other challenge in the lesson first", () => {
    const progress = { "01-text-traps": { status: "in_progress" as const, attempts: 1, passedChallengeIds: ["predict-text"] } };
    const next = nextStepAfterPass(units, progress, units[0]);
    expect(next.kind === "challenge" && next.challenge.id).toBe("fix-same-username");
  });

  it("then the next unfinished lesson, wrapping round to earlier ones", () => {
    const progress: ProgressMap = { "03-time-traps": done("03-time-traps", ["predict-time"]), "02-number-traps": done("02-number-traps", ["predict-numbers"]) };
    const next = nextStepAfterPass(units, progress, units[2]);
    expect(next.kind === "lesson" && next.unit.id).toBe("01-text-traps");
  });

  it("then says the course is done", () => {
    const progress: ProgressMap = {
      "01-text-traps": done("01-text-traps", ["predict-text", "fix-same-username"]),
      "02-number-traps": done("02-number-traps", ["predict-numbers"]),
      "03-time-traps": done("03-time-traps", ["predict-time"]),
    };
    expect(nextStepAfterPass(units, progress, units[1]).kind).toBe("course-done");
  });
});
