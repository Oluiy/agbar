import path from "node:path";
import * as clack from "@clack/prompts";
import type { ScaffoldConfig } from "./config.js";
import type { StackAdapter } from "./stacks/StackAdapter.js";
import type { VerifyResult } from "./stacks/verifyResult.js";

export interface GeneratedProject {
  outDir: string;
  /** Present when the adapter installed and tested what it generated. */
  verify?: VerifyResult;
}

/**
 * Orchestrates generation for whichever StackAdapter was chosen. Knows nothing
 * about the target language - it only calls the StackAdapter contract.
 * Mirrors BuildQuickPkg's SolutionScaffolder.Generate(ScaffoldingConfig), generalized
 * to dispatch across adapters instead of being ASP.NET-Core-specific.
 */
export async function generateProject(config: ScaffoldConfig, adapter: StackAdapter): Promise<GeneratedProject> {
  const outDir = path.join(config.outputDirectory, config.projectName);

  if (adapter.interactiveHandoff) {
    // No spinner: the adapter is about to share the terminal with another
    // program's own live interactive prompts.
    clack.log.step(`Handing off to ${adapter.label}...`);
    const result = await adapter.generate(config, outDir);
    return { outDir, verify: result?.verify };
  }

  const s = clack.spinner();
  s.start(`Generating ${adapter.label} solution...`);
  try {
    const result = await adapter.generate(config, outDir);
    s.stop(`Generated at ${outDir}`);
    return { outDir, verify: result?.verify };
  } catch (err) {
    s.stop("Generation failed.");
    throw err;
  }
}
