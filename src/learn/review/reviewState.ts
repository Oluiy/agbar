import os from "node:os";
import path from "node:path";
import { writeFile } from "../../utils/fsWrite.js";
import { readJsonFile } from "../../utils/jsonFile.js";
import type { QuestionState } from "./schedule.js";

/**
 * Per-question review state, stored apart from lesson progress: progress records
 * whether you passed a unit, this records how well you still remember it. Keyed
 * "unitId#questionId". Path injectable so tests never touch the real home dir.
 */
export type ReviewStateMap = Record<string, QuestionState>;

export function defaultReviewStatePath(language: string): string {
  return path.join(os.homedir(), ".agbar", "learn", "review", `${language}.json`);
}

export function questionKey(unitId: string, questionId: string): string {
  return `${unitId}#${questionId}`;
}

export function loadReviewState(statePath: string): ReviewStateMap {
  return readJsonFile<ReviewStateMap>(statePath, {}, "review schedule");
}

export function saveReviewState(statePath: string, state: ReviewStateMap): void {
  writeFile(statePath, JSON.stringify(state, null, 2));
}
