#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import * as clack from "@clack/prompts";
import pc from "picocolors";
import { runPrompts } from "./prompts.js";
import { resolveNonInteractive, type NonInteractiveFlags } from "./nonInteractive.js";
import { generateProject } from "./engine.js";
import { aspnetcoreAdapter } from "./stacks/aspnetcore/adapter.js";
import { springbootAdapter } from "./stacks/springboot/adapter.js";
import type { StackAdapter } from "./stacks/StackAdapter.js";
import type { ScaffoldConfig } from "./config.js";
import { buildRecommendationContext, getRecommendations, type RecommendationTier } from "./recommendations.js";
import { buildDecisionContext, getDecisions } from "./explain.js";
import { renderArchitectureDoc } from "./explainRender.js";
import { writeFile } from "./utils/fsWrite.js";

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

function writeArchitectureNotes(outDir: string, config: ScaffoldConfig, adapter: StackAdapter): void {
  const ctx = buildDecisionContext(adapter.id, config.addons, config.includeTests, config.isMicroservice);
  const decisions = getDecisions(ctx);
  if (decisions.length === 0) return;

  const doc = renderArchitectureDoc(config.projectName, decisions);
  writeFile(path.join(outDir, "ARCHITECTURE.md"), doc);
  clack.log.message(
    pc.bold(`Wrote ARCHITECTURE.md - ${decisions.length} callout${decisions.length === 1 ? "" : "s"} explaining why this project is shaped the way it is.`)
  );
}

function printRecommendations(config: ScaffoldConfig, adapter: StackAdapter): void {
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

const stacks: StackAdapter[] = [aspnetcoreAdapter, springbootAdapter];

const program = new Command();

program
  .name("buildquick")
  .description("Interactive universal backend scaffolder: pick a stack and get a fully-wired, Clean-Architecture-shaped solution in seconds.")
  .version("0.1.0")
  .argument("[projectName]", "Project name (skips the name prompt)")
  .option("-y, --yes", "Run non-interactively, filling in anything unspecified with defaults (requires --stack, or set it in --config)")
  .option("--config <path>", "Path to a JSON config file for non-interactive generation - see README")
  .option("--stack <id>", "Stack to generate: aspnetcore | springboot")
  .option("--structure <mode>", "Spring Boot only: multi-module | package-by-layer | package-by-feature")
  .option("--four-layer", "Spring Boot multi-module: use 4 layers (API/Application/Domain/Infrastructure)")
  .option("--three-layer", "Spring Boot multi-module: use 3 layers (API/Application/Domain)")
  .option("--db <provider>", "Database provider: none | postgres | mysql")
  .option("--jwt", "Include JWT authentication boilerplate")
  .option("--docker", "Include Dockerfile & docker-compose.yml")
  .option("--no-tests", "Skip generating a test project (included by default)")
  .option("--microservice", "Generate independent services instead of one monolith")
  .option("--services <names>", "Comma-separated service names (implies --microservice)")
  .option("--port <number>", "Base HTTP port (default: 8080)")
  .option("--llm-api", "This project calls an LLM API (OpenAI/Anthropic/Groq/...) - drives the ai-cost-guard recommendation")
  .option("--no-explain", "Skip generating ARCHITECTURE.md (the why-this-is-shaped-this-way notes)")
  .action(async (projectNameArg: string | undefined, opts: NonInteractiveFlags & { yes?: boolean; explain?: boolean }) => {
    const nonInteractive = Boolean(opts.yes || opts.config);
    try {
      const { config, adapter } = nonInteractive
        ? resolveNonInteractive(stacks, opts, projectNameArg)
        : await runPrompts(stacks, projectNameArg);

      const outDir = await generateProject(config, adapter);
      printRecommendations(config, adapter);
      if (opts.explain !== false) writeArchitectureNotes(outDir, config, adapter);

      const doneMessage = pc.green(`Done. cd into "${config.projectName}" to get started.`);
      if (nonInteractive) {
        console.log(doneMessage);
      } else {
        clack.outro(doneMessage);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // clack.log.error assumes an active prompt session (intro() was called);
      // a plain stderr line is the right shape for a scripted/CI run instead.
      if (nonInteractive) {
        console.error(pc.red(message));
      } else {
        clack.log.error(message);
      }
      process.exitCode = 1;
    }
  });

program.parseAsync();
