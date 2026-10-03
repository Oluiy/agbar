import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProgress, recordAttempt, statusFor } from "./progress.js";

let tmpDir: string;
let progressPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "buildquick-progress-test-"));
  progressPath = path.join(tmpDir, "rust.json");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("progress", () => {
  it("returns an empty map when no progress file exists yet", () => {
    expect(loadProgress(progressPath)).toEqual({});
  });

  it("marks a unit in_progress after a failed attempt, incrementing attempts", () => {
    recordAttempt(progressPath, "u1", "c1", false, ["c1", "c2"]);
    const map = loadProgress(progressPath);
    expect(map.u1.status).toBe("in_progress");
    expect(map.u1.attempts).toBe(1);
    expect(map.u1.passedChallengeIds).toEqual([]);
  });

  it("stays in_progress after only some of a unit's challenges pass", () => {
    recordAttempt(progressPath, "u1", "c1", true, ["c1", "c2"]);
    expect(statusFor(loadProgress(progressPath), "u1")).toBe("in_progress");
  });

  it("marks done only once every challenge in the unit has passed", () => {
    recordAttempt(progressPath, "u1", "c1", true, ["c1", "c2"]);
    recordAttempt(progressPath, "u1", "c2", true, ["c1", "c2"]);
    const map = loadProgress(progressPath);
    expect(map.u1.status).toBe("done");
    expect(map.u1.completedAt).toBeDefined();
    expect(map.u1.attempts).toBe(2);
  });

  it("statusFor returns not_started for a unit with no recorded progress", () => {
    expect(statusFor({}, "nope")).toBe("not_started");
  });
});
