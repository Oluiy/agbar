import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import type { ScaffoldConfig } from "./config.js";
import type { RunContext, StackAdapter } from "./stacks/StackAdapter.js";
import type { VerifyResult } from "./stacks/verifyResult.js";
import type { Reporter } from "./ui/progress.js";

export interface GeneratedProject {
  outDir: string;
  /** Present when dependencies were installed and tests run (or that was attempted). */
  verify?: VerifyResult;
}

/** The user cancelled before the project was complete. Nothing was left behind. */
export class CancelledError extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "CancelledError";
  }
}

/** The destination already holds files; generating into it would silently merge. */
export class DestinationNotEmptyError extends Error {
  constructor(readonly directory: string) {
    super(`${directory} already exists and is not empty. Choose another project name, or remove it first.`);
    this.name = "DestinationNotEmptyError";
  }
}

export interface GenerateOptions {
  reporter: Reporter;
  /** Aborted on Ctrl-C. The caller (the CLI) owns the signal handler; the engine only obeys the signal. */
  signal?: AbortSignal;
}

function isNonEmptyDirectory(dir: string): boolean {
  return existsSync(dir) && readdirSync(dir).length > 0;
}

/**
 * Orchestrates generation for whichever StackAdapter was chosen. Knows nothing about the
 * target language - it only calls the StackAdapter contract.
 * Mirrors BuildQuickPkg's SolutionScaffolder.Generate(ScaffoldingConfig), generalized to
 * dispatch across adapters instead of being ASP.NET-Core-specific.
 *
 * Two phases with different guarantees, because they fail differently:
 *
 *   1. generate - writes files, takes well under a second for most stacks. All or nothing:
 *      if it fails or is cancelled, the destination is removed, so there is never a
 *      half-written project to puzzle over.
 *   2. verify - optional; installs dependencies and runs the new project's tests, which can
 *      take minutes on a slow network. The project is already good by now, so a failure or a
 *      cancel here keeps it and reports what happened.
 */
export async function generateProject(
  config: ScaffoldConfig,
  adapter: StackAdapter,
  { reporter, signal = new AbortController().signal }: GenerateOptions
): Promise<GeneratedProject> {
  const outDir = path.join(config.outputDirectory, config.projectName);

  // Refuse before touching anything: cleanup-on-failure below removes outDir, which is only
  // safe because we know it held nothing of the user's.
  if (isNonEmptyDirectory(outDir)) throw new DestinationNotEmptyError(outDir);

  const context: RunContext = { signal, step: (label) => reporter.step(label) };
  const discard = () => rmSync(outDir, { recursive: true, force: true });

  // The adapter's own interactive prompts need the terminal, so no animation over them.
  if (adapter.interactiveHandoff) {
    try {
      await adapter.generate(config, outDir, context);
    } catch (error) {
      discard();
      throw error;
    }
    return { outDir };
  }

  reporter.start(`Generating ${adapter.label} project`);
  try {
    await adapter.generate(config, outDir, context);
    // A cancel that arrived while the adapter was busy and could not stop mid-write.
    if (signal.aborted) throw new CancelledError();
  } catch (error) {
    discard();
    const cancelled = signal.aborted || error instanceof CancelledError;
    reporter.fail(cancelled ? "Cancelled - nothing was created." : "Generation failed.");
    if (cancelled) throw new CancelledError();
    throw error;
  }
  reporter.succeed(`Generated at ${outDir}`);

  if (!adapter.verify || config.addons.install !== true) return { outDir };

  reporter.start("Installing dependencies and running the tests (this can take a few minutes)");
  const verify = await adapter.verify(config, outDir, context);
  if (signal.aborted || verify.cancelled) {
    reporter.fail("Install cancelled - your project was kept.");
    return { outDir, verify: { ...verify, cancelled: true } };
  }
  if (verify.installed === true && verify.testsPassed === true) reporter.succeed("Installed, and the tests pass");
  else reporter.fail("Could not fully verify the project");
  return { outDir, verify };
}
