import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findTrack, loadTracks } from "./tracks.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "buildquick-tracks-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeTracks(contents: string): string {
  const p = path.join(tmpDir, "tracks.yaml");
  writeFileSync(p, contents, "utf-8");
  return p;
}

const VALID = `
tracks:
  - id: "t1"
    title: "T One"
    audience: "Students"
    description: "A track."
    steps:
      - concept: "caching"
      - unit: "rust/04-ownership-basics"
`;

describe("loadTracks", () => {
  it("parses concept and unit steps", () => {
    const tracks = loadTracks(writeTracks(VALID));
    expect(tracks).toHaveLength(1);
    expect(tracks[0].steps[0]).toEqual({ conceptId: "caching" });
    expect(tracks[0].steps[1]).toEqual({ unit: { language: "rust", unitId: "04-ownership-basics" } });
  });

  it("throws when a concept step references an unknown concept", () => {
    const p = writeTracks(VALID.replace('concept: "caching"', 'concept: "not-a-concept"'));
    expect(() => loadTracks(p)).toThrow(/concept 'not-a-concept' doesn't match/);
  });

  it("throws when a unit step references a unit that doesn't exist", () => {
    const p = writeTracks(VALID.replace("rust/04-ownership-basics", "rust/no-such-unit"));
    expect(() => loadTracks(p)).toThrow(/unit 'rust\/no-such-unit' doesn't exist/);
  });

  it("throws when a unit step isn't language-qualified", () => {
    const p = writeTracks(VALID.replace("rust/04-ownership-basics", "04-ownership-basics"));
    expect(() => loadTracks(p)).toThrow(/must be in '<language>\/<unit-id>' form/);
  });

  it("throws for a missing required field", () => {
    const p = writeTracks(VALID.replace('audience: "Students"', ""));
    expect(() => loadTracks(p)).toThrow(/missing required field 'audience'/);
  });

  it("throws for a step with neither concept nor unit", () => {
    const p = writeTracks(VALID.replace('- concept: "caching"', "- note: nothing"));
    expect(() => loadTracks(p)).toThrow(/missing both 'concept' and 'unit'/);
  });
});

describe("the bundled tracks.yaml", () => {
  it("loads and validates every step against real concepts and units", () => {
    const tracks = loadTracks();
    expect(tracks.length).toBeGreaterThanOrEqual(5);
    expect(tracks.map((t) => t.id)).toContain("production-readiness");
  });
});

describe("findTrack", () => {
  it("matches by exact id, then by substring", () => {
    const tracks = loadTracks();
    expect(findTrack(tracks, "interview-prep")?.id).toBe("interview-prep");
    expect(findTrack(tracks, "interview")?.id).toBe("interview-prep");
    expect(findTrack(tracks, "nope")).toBeUndefined();
  });
});
