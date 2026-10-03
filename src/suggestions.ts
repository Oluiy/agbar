import type { DecisionContext } from "./explain.js";

/**
 * Closes the loop between scaffolding and tutoring: after generating a project,
 * point at the track and concepts that match what was actually selected, rather
 * than a generic "go learn things" blurb. Same data-driven shape as
 * recommendations.ts, and it reuses explain.ts's DecisionContext so there's only
 * one place that reads a stack's addons bag.
 *
 * Deliberately does NOT load content/tracks.yaml at generation time: a user with
 * BUILDQUICK_CONTENT pointed at a directory without tracks.yaml would otherwise
 * crash a successful scaffold on its last line. Track ids and titles are carried
 * here as data, and a test validates they resolve against the real content.
 */

export interface TrackSuggestion {
  trackId: string;
  title: string;
  reason: string;
  appliesTo: (ctx: DecisionContext) => boolean;
}

export interface ConceptSuggestion {
  conceptId: string;
  reason: string;
  appliesTo: (ctx: DecisionContext) => boolean;
}

/** First match wins - one track, never a menu. */
const TRACK_SUGGESTIONS: TrackSuggestion[] = [
  {
    trackId: "production-readiness",
    title: "Production readiness review",
    reason: "you scaffolded real infrastructure, so this is the shortlist before it takes real traffic",
    appliesTo: (ctx) => ctx.hasDb || ctx.isMicroservice || ctx.includeDocker,
  },
  {
    trackId: "student-backend",
    title: "Backend fundamentals",
    reason: "the concepts that separate this from an API that survives real traffic",
    appliesTo: () => true,
  },
];

/** Capped when printed - specific beats exhaustive right after a scaffold. */
const CONCEPT_SUGGESTIONS: ConceptSuggestion[] = [
  {
    conceptId: "security-by-design",
    reason: "you enabled JWT",
    appliesTo: (ctx) => ctx.includeJwt,
  },
  {
    conceptId: "pagination",
    reason: "you added a database, and your first list endpoint will need it",
    appliesTo: (ctx) => ctx.hasDb,
  },
  {
    conceptId: "n-plus-one-queries",
    reason: "you added a database, and most ORMs cause this by default",
    appliesTo: (ctx) => ctx.hasDb,
  },
  {
    conceptId: "communication-patterns",
    reason: "you generated independent services that have to talk to each other",
    appliesTo: (ctx) => ctx.isMicroservice,
  },
  {
    conceptId: "secrets-management",
    reason: "you generated Docker config, which is where credentials usually leak in",
    appliesTo: (ctx) => ctx.includeDocker,
  },
];

export const MAX_CONCEPT_SUGGESTIONS = 3;

export function suggestTrack(ctx: DecisionContext): TrackSuggestion | undefined {
  return TRACK_SUGGESTIONS.find((s) => s.appliesTo(ctx));
}

export function suggestConcepts(ctx: DecisionContext, limit = MAX_CONCEPT_SUGGESTIONS): ConceptSuggestion[] {
  return CONCEPT_SUGGESTIONS.filter((s) => s.appliesTo(ctx)).slice(0, limit);
}

/** Exported for the test that validates every id resolves against real content. */
export const ALL_SUGGESTIONS = { tracks: TRACK_SUGGESTIONS, concepts: CONCEPT_SUGGESTIONS };
