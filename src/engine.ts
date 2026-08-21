import path from "node:path";
import * as clack from "@clack/prompts";
import type { ScaffoldConfig } from "./config.js";
import type { StackAdapter } from "./stacks/StackAdapter.js";

/**
 * Orchestrates generation for whichever StackAdapter was chosen. Knows nothing
 * about the target language - it only calls the StackAdapter contract.
 * Mirrors BuildQuickPkg's SolutionScaffolder.Generate(ScaffoldingConfig), generalized
 * to dispatch across adapters instead of being ASP.NET-Core-specific.
 */
export async function generateProject(config: ScaffoldConfig, adapter: StackAdapter): Promise<string> {
  const outDir = path.join(config.outputDirectory, config.projectName);

  if (adapter.interactiveHandoff) {
    // No spinner: the adapter is about to share the terminal with another
    // program's own live interactive prompts.
    clack.log.step(`Handing off to ${adapter.label}...`);
    await adapter.generate(config, outDir);
    return outDir;
  }

  const s = clack.spinner();
  s.start(`Generating ${adapter.label} solution...`);
  try {
    await adapter.generate(config, outDir);
    s.stop(`Generated at ${outDir}`);
    return outDir;
  } catch (err) {
    s.stop("Generation failed.");
    throw err;
  }
}
