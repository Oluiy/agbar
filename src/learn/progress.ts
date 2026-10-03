import os from "node:os";
import path from "node:path";
import { writeFile } from "../utils/fsWrite.js";
import { readJsonFile } from "../utils/jsonFile.js";

export type UnitStatus = "not_started" | "in_progress" | "done";

export interface UnitProgress {
  status: "in_progress" | "done";
  attempts: number;
  /** Which challenge ids have passed at least once - a unit is "done" only once this covers every challenge it has, not just the most recently submitted one. */
  passedChallengeIds: string[];
  completedAt?: string;
}

export type ProgressMap = Record<string, UnitProgress>;

/** Path is injectable so tests never touch the real home directory - same DI convention as ScaffoldConfig.outputDirectory. */
export function defaultProgressPath(language: string): string {
  return path.join(os.homedir(), ".buildquick", "learn", "progress", `${language}.json`);
}

export function loadProgress(progressPath: string): ProgressMap {
  return readJsonFile<ProgressMap>(progressPath, {}, "lesson progress");
}

function saveProgress(progressPath: string, map: ProgressMap): void {
  writeFile(progressPath, JSON.stringify(map, null, 2));
}

/**
 * Records one submission attempt for a challenge. Always increments the
 * unit's attempt count; on a pass, adds the challenge to passedChallengeIds
 * and only flips the unit to "done" once every challenge in totalChallengeIds
 * has passed at least once - a unit with 2 challenges isn't "done" just
 * because the first one submitted happened to pass.
 */
export function recordAttempt(progressPath: string, unitId: string, challengeId: string, passed: boolean, totalChallengeIds: string[]): ProgressMap {
  const map = loadProgress(progressPath);
  const existing = map[unitId];
  const passedChallengeIds = new Set(existing?.passedChallengeIds ?? []);
  if (passed) passedChallengeIds.add(challengeId);

  const allPassed = totalChallengeIds.every((id) => passedChallengeIds.has(id));
  map[unitId] = {
    status: allPassed ? "done" : "in_progress",
    attempts: (existing?.attempts ?? 0) + 1,
    passedChallengeIds: [...passedChallengeIds],
    completedAt: allPassed ? (existing?.completedAt ?? new Date().toISOString()) : undefined,
  };

  saveProgress(progressPath, map);
  return map;
}

export function statusFor(map: ProgressMap, unitId: string): UnitStatus {
  return map[unitId]?.status ?? "not_started";
}
