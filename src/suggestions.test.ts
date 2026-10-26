import { describe, expect, it } from "vitest";
import { BACKEND_CONCEPTS } from "./concepts/index.js";
import { buildDecisionContext } from "./explain.js";
import { loadTracks } from "./learn/tracks.js";
import { ALL_SUGGESTIONS, MAX_CONCEPT_SUGGESTIONS, suggestConcepts, suggestTrack } from "./suggestions.js";

const bare = buildDecisionContext("springboot", { structure: "package-by-layer" }, true, false);
const withDb = buildDecisionContext("springboot", { dbProvider: "postgres" }, true, false);
const loaded = buildDecisionContext("springboot", { dbProvider: "postgres", includeJwt: true, includeDocker: true }, true, true);

describe("suggestion ids resolve against real content", () => {
  // The reason suggestions.ts carries ids as data instead of loading tracks at
  // generation time: this catches a typo at test time, without coupling a
  // successful scaffold to content loading that a custom BUILDQUICK_CONTENT
  // directory might not satisfy.
  it("every suggested track exists in tracks.yaml", () => {
    const trackIds = new Set(loadTracks().map((t) => t.id));
    for (const s of ALL_SUGGESTIONS.tracks) {
      expect(trackIds.has(s.trackId), `track '${s.trackId}' doesn't exist`).toBe(true);
    }
  });

  it("every suggested concept exists in concepts.ts", () => {
    const conceptIds = new Set(BACKEND_CONCEPTS.map((c) => c.id));
    for (const s of ALL_SUGGESTIONS.concepts) {
      expect(conceptIds.has(s.conceptId), `concept '${s.conceptId}' doesn't exist`).toBe(true);
    }
  });
});

describe("suggestTrack", () => {
  it("suggests production-readiness once real infrastructure is involved", () => {
    expect(suggestTrack(withDb)?.trackId).toBe("production-readiness");
    expect(suggestTrack(loaded)?.trackId).toBe("production-readiness");
  });

  it("falls back to student-backend for a bare project", () => {
    expect(suggestTrack(bare)?.trackId).toBe("student-backend");
  });

  it("always returns exactly one track, never a menu", () => {
    for (const ctx of [bare, withDb, loaded]) {
      expect(suggestTrack(ctx)).toBeDefined();
    }
  });
});

describe("suggestConcepts", () => {
  it("suggests nothing extra for a bare project - the track already covers the basics", () => {
    expect(suggestConcepts(bare)).toEqual([]);
  });

  it("ties suggestions to what was actually selected", () => {
    expect(suggestConcepts(withDb).map((c) => c.conceptId)).toEqual(["pagination", "n-plus-one-queries"]);
  });

  it("caps output so a scaffold doesn't end in a wall of links", () => {
    const ids = suggestConcepts(loaded).map((c) => c.conceptId);
    expect(ids.length).toBeLessThanOrEqual(MAX_CONCEPT_SUGGESTIONS);
    expect(ids[0]).toBe("security-by-design");
  });
});

describe("an LLM project gets the advice the scaffold cannot give it", () => {
  it("suggests prompt-injection only when the project calls an LLM API", () => {
    const llm = buildDecisionContext("springboot", { dbProvider: "postgres" }, true, false, true);
    const noLlm = buildDecisionContext("springboot", { dbProvider: "postgres" }, true, false, false);

    expect(suggestConcepts(llm).map((s) => s.conceptId)).toContain("prompt-injection");
    expect(suggestConcepts(noLlm).map((s) => s.conceptId)).not.toContain("prompt-injection");
  });
});
