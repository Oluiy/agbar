import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { BACKEND_CONCEPTS } from "../concepts/index.js";
import { resolveContentPath } from "./contentDir.js";
import { loadUnits } from "./loader.js";

/**
 * The curriculum layer. A track is an ordered path through content that already
 * exists - concepts to read and units to practice - grouped for one audience.
 * This is deliberately just data: adding a track never touches the engine.
 */

export interface TrackStep {
  /** Exactly one of these is set. */
  conceptId?: string;
  unit?: { language: string; unitId: string };
}

export interface Track {
  id: string;
  title: string;
  audience: string;
  description: string;
  steps: TrackStep[];
}

function parseStep(raw: Record<string, unknown>, trackId: string, index: number): TrackStep {
  const where = `track '${trackId}' step ${index + 1}`;
  const concept = raw.concept;
  const unit = raw.unit;

  if (typeof concept === "string" && typeof unit === "string") {
    throw new Error(`${where}: set either 'concept' or 'unit', not both.`);
  }
  if (typeof concept === "string") return { conceptId: concept };

  if (typeof unit === "string") {
    // "rust/04-ownership-basics" - language-qualified so a track can span languages.
    const [language, unitId] = unit.split("/");
    if (!language || !unitId) {
      throw new Error(`${where}: unit '${unit}' must be in '<language>/<unit-id>' form.`);
    }
    return { unit: { language, unitId } };
  }

  throw new Error(`${where}: missing both 'concept' and 'unit'.`);
}

function parseTrack(raw: Record<string, unknown>): Track {
  const id = raw.id;
  if (typeof id !== "string" || id === "") throw new Error("tracks.yaml: a track is missing 'id'.");

  for (const field of ["title", "audience", "description"]) {
    if (typeof raw[field] !== "string" || raw[field] === "") {
      throw new Error(`track '${id}': missing required field '${field}'.`);
    }
  }

  const rawSteps = raw.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    throw new Error(`track '${id}': missing required field 'steps' (must be a non-empty list).`);
  }

  return {
    id,
    title: raw.title as string,
    audience: raw.audience as string,
    description: raw.description as string,
    steps: rawSteps.map((s, i) => parseStep(s as Record<string, unknown>, id, i)),
  };
}

/**
 * Loads every track and validates each step actually resolves - an unknown
 * concept id or a unit that doesn't exist throws immediately rather than
 * producing a track that dead-ends halfway through. Same fail-loudly contract
 * as loader.ts.
 */
export function loadTracks(tracksFileOverride?: string): Track[] {
  const tracksPath = tracksFileOverride ?? resolveContentPath("tracks.yaml");
  if (!tracksPath) throw new Error("Couldn't find tracks.yaml in any content root.");

  const raw = parse(readFileSync(tracksPath, "utf-8")) as { tracks?: unknown };
  if (!Array.isArray(raw?.tracks) || raw.tracks.length === 0) {
    throw new Error(`${tracksPath}: expected a non-empty 'tracks' list.`);
  }

  const tracks = raw.tracks.map((t) => parseTrack(t as Record<string, unknown>));

  const conceptIds = new Set(BACKEND_CONCEPTS.map((c) => c.id));
  const unitIdsByLanguage = new Map<string, Set<string>>();

  for (const track of tracks) {
    for (const step of track.steps) {
      if (step.conceptId && !conceptIds.has(step.conceptId)) {
        throw new Error(`track '${track.id}': concept '${step.conceptId}' doesn't match any known concept.`);
      }
      if (step.unit) {
        const { language, unitId } = step.unit;
        if (!unitIdsByLanguage.has(language)) {
          unitIdsByLanguage.set(language, new Set(loadUnits(language).map((u) => u.id)));
        }
        if (!unitIdsByLanguage.get(language)!.has(unitId)) {
          throw new Error(`track '${track.id}': unit '${language}/${unitId}' doesn't exist.`);
        }
      }
    }
  }

  return tracks;
}

export function findTrack(tracks: Track[], id: string): Track | undefined {
  const q = id.trim().toLowerCase();
  return tracks.find((t) => t.id === q) ?? tracks.find((t) => t.id.includes(q));
}
