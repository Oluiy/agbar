import path from "node:path";
import * as clack from "@clack/prompts";
import pc from "picocolors";
import type { ScaffoldConfig } from "./config.js";
import { renderLevelingUpDoc } from "./conceptsRender.js";
import { buildDecisionContext, getDecisions } from "./explain.js";
import { renderArchitectureDoc } from "./explainRender.js";
import { buildRecommendationContext, getRecommendations, type RecommendationTier } from "./recommendations.js";
import type { StackAdapter } from "./stacks/StackAdapter.js";
import { suggestConcepts, suggestTrack } from "./suggestions.js";
import { writeFile } from "./utils/fsWrite.js";

/**
 * Everything that happens after a project is generated: the teaching docs written
 * into it, the tool recommendations, and the suggested learning track. Kept out of
 * cli.ts so that file stays a list of commands rather than a mix of wiring and
 * presentation.
 */

const TIER_LABEL: Record<RecommendationTier, string> = {
  essential: "Essential",
  production: "Before you ship",
  scale: "At scale",
};

const TIER_COLOR: Record<RecommendationTier, (s: string) => string> = {
  essential: pc.green,
  production: pc.yellow,
  scale: pc.cyan,
};

export function writeTeachingDocs(outDir: string, config: ScaffoldConfig, adapter: StackAdapter): void {
  const ctx = buildDecisionContext(adapter.id, config.addons, config.includeTests, config.isMicroservice);
  const decisions = getDecisions(ctx);
  if (decisions.length === 0) return;

  writeFile(path.join(outDir, "ARCHITECTURE.md"), renderArchitectureDoc(config.projectName, decisions));
  writeFile(path.join(outDir, "LEVELING-UP.md"), renderLevelingUpDoc(config.projectName));

  clack.log.message(
    pc.bold(
      `Wrote ARCHITECTURE.md (${decisions.length} callout${decisions.length === 1 ? "" : "s"} on why this project is shaped the way it is) and LEVELING-UP.md (reliability concepts this scaffold doesn't cover yet).`
    )
  );
}

export function printLearningSuggestions(config: ScaffoldConfig, adapter: StackAdapter): void {
  const ctx = buildDecisionContext(adapter.id, config.addons, config.includeTests, config.isMicroservice, config.usesLlmApi);
  const track = suggestTrack(ctx);
  const concepts = suggestConcepts(ctx);
  if (!track && concepts.length === 0) return;

  clack.log.message(pc.bold("Next, to understand what you just built:"));
  if (track) {
    clack.log.message(`    ${pc.bold(track.title)} - ${pc.dim(`agbar tracks ${track.trackId}`)}\n    ${track.reason}`);
  }
  for (const concept of concepts) {
    clack.log.message(`    ${pc.dim(`agbar concepts ${concept.conceptId}`)} - ${concept.reason}`);
  }
}

export function printRecommendations(config: ScaffoldConfig, adapter: StackAdapter): void {
  const ctx = buildRecommendationContext(adapter.id, config.addons, config.includeTests, config.usesLlmApi);
  const recommendations = getRecommendations(ctx);
  if (recommendations.length === 0) return;

  clack.log.message(pc.bold("Recommended for what you just built:"));
  let lastTier: RecommendationTier | null = null;
  for (const rec of recommendations) {
    if (rec.tier !== lastTier) {
      clack.log.message(TIER_COLOR[rec.tier](`  ${TIER_LABEL[rec.tier]}`));
      lastTier = rec.tier;
    }
    clack.log.message(`    ${pc.bold(rec.name)} - ${rec.description}\n    ${pc.dim(rec.url)}`);
  }
}
