import type { ScaffoldConfig } from "../config.js";

/**
 * The contract every supported stack implements. `engine.ts` and `prompts.ts`
 * only ever talk to this interface - they know nothing about C#, Java, or Rust.
 * This is what makes the tool "language-agnostic": adding a new stack means
 * writing a new StackAdapter, not touching the engine.
 */
export interface StackAdapter {
  readonly id: string; // Stable identifier, e.g. "aspnetcore" | "springboot" | "rust". Used for CLI flags and config persistence.
  readonly label: string; // Shown in the stack-selection prompt.
  readonly interactiveHandoff?: boolean; // Whether `generate` hands off to another program's own interactive prompts.
  // False if `generate` requires actual interactive input it cannot get non-interactively
  // (e.g. handing off to another program's own prompts, like the ASP.NET Core adapter).
  // Non-interactive mode (--yes/--config) refuses cleanly for these instead of hanging
  // forever waiting for input that will never come. Defaults to true.
  readonly supportsNonInteractive?: boolean;
  readonly promptAddons: () => Promise<Record<string, unknown>>; // Prompts for anything specific to this stack (database provider, JWT, Docker, API style, ...) and returns the answers as a plain object. Merged into `ScaffoldConfig.addons` by the engine before `generate` is called.
  // Non-interactive equivalent of promptAddons(): validates and fills in defaults for `raw`
  // (parsed from --config JSON or individual CLI flags), returning the same shape
  // promptAddons() would have collected. Throws a specific, actionable error on anything
  // invalid rather than silently defaulting - a scripted/CI run should fail loudly on bad
  // input, not silently generate something the caller didn't ask for.
  readonly resolveAddons: (raw: Record<string, unknown>) => Record<string, unknown>;
  readonly generate: (config: ScaffoldConfig, outDir: string) => Promise<void>; // Writes the generated project to `outDir`. Throws on failure; writes nothing partial on a thrown error where practical.
}
