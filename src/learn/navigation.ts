import type { ProgressMap } from "./progress.js";
import type { Challenge, Unit } from "./types.js";

/**
 * Where am I, and where next? The pure logic behind making lessons easy to
 * reach: typing `2` instead of `02-number-traps`, `agbar submit` without
 * retyping anything, and always ending on a concrete next step.
 */

/**
 * A lesson by its full id, its number (`2`, `02`), an id prefix (`02-num`), or
 * a unique part of its id or title (`money`). Undefined if nothing, or more than
 * one lesson, fits - an ambiguous guess would open the wrong lesson.
 */
export function resolveLesson(units: Unit[], query: string): Unit | undefined {
  const q = query.trim().toLowerCase();
  const exact = units.find((u) => u.id === q);
  if (exact) return exact;
  if (/^\d+$/.test(q)) {
    const n = Number(q);
    return units.find((u) => u.chapterRef === n) ?? units[n - 1];
  }
  const byPrefix = units.filter((u) => u.id.startsWith(q));
  if (byPrefix.length === 1) return byPrefix[0];
  const byText = units.filter((u) => u.id.includes(q) || u.title.toLowerCase().includes(q));
  return byText.length === 1 ? byText[0] : undefined;
}

/** The challenge `submit` means: the one named, else the first not yet passed, else the first. */
export function pickChallenge(unit: Unit, progress: ProgressMap, challengeId?: string): Challenge | undefined {
  if (challengeId) return unit.challenges.find((c) => c.id === challengeId);
  const passed = new Set(progress[unit.id]?.passedChallengeIds ?? []);
  return unit.challenges.find((c) => !passed.has(c.id)) ?? unit.challenges[0];
}

export type NextStep = { kind: "challenge"; challenge: Challenge } | { kind: "lesson"; unit: Unit } | { kind: "course-done" };

/** After a pass: the next challenge in this lesson, else the next unfinished lesson in the course, else done. */
export function nextStepAfterPass(units: Unit[], progress: ProgressMap, unit: Unit): NextStep {
  const passed = new Set(progress[unit.id]?.passedChallengeIds ?? []);
  const nextChallenge = unit.challenges.find((c) => !passed.has(c.id));
  if (nextChallenge) return { kind: "challenge", challenge: nextChallenge };
  const at = units.findIndex((u) => u.id === unit.id);
  const nextLesson = [...units.slice(at + 1), ...units.slice(0, at)].find((u) => progress[u.id]?.status !== "done");
  return nextLesson ? { kind: "lesson", unit: nextLesson } : { kind: "course-done" };
}
