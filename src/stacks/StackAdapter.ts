import type { ScaffoldConfig } from "../config.js";
import type { VerifyResult } from "./verifyResult.js";

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
  /**
   * Which of the cross-stack questions this stack actually uses. A question a stack ignores
   * is a bug twice over: the user answers it for nothing, and believes the answer mattered
   * (a FastAPI project asked for port 8080 still runs on 8000). Omitted means "all of them",
   * so a stack that has not been audited keeps asking.
   */
  readonly capabilities?: Partial<StackCapabilities>;
  readonly promptAddons: () => Promise<Record<string, unknown>>; // Prompts for anything specific to this stack (database provider, JWT, Docker, API style, ...) and returns the answers as a plain object. Merged into `ScaffoldConfig.addons` by the engine before `generate` is called.
  // Non-interactive equivalent of promptAddons(): validates and fills in defaults for `raw`
  // (parsed from --config JSON or individual CLI flags), returning the same shape
  // promptAddons() would have collected. Throws a specific, actionable error on anything
  // invalid rather than silently defaulting - a scripted/CI run should fail loudly on bad
  // input, not silently generate something the caller didn't ask for.
  //
  // Called with `{}` it is also the stack's "recommended defaults", which is what the quick
  // path in the prompts uses: one definition of "the sensible choice", not two.
  readonly resolveAddons: (raw: Record<string, unknown>) => Record<string, unknown>;
  /**
   * Writes the generated project to `outDir`. Throws on failure. The engine removes `outDir`
   * if this throws or is cancelled, so an adapter need not clean up after itself.
   *
   * Writing files only. Installing dependencies and running tests is `verify`, a separate
   * phase: it has different failure semantics (the project is still good if it fails) and
   * takes minutes instead of milliseconds.
   */
  readonly generate: (config: ScaffoldConfig, outDir: string, context: RunContext) => Promise<void>;
  /**
   * Optional: install the generated project's dependencies and run its own tests. Run by the
   * engine only when `config.addons.install === true` (a convention shared by the stacks
   * that implement this). Must not throw for an ordinary failure - report it in the result.
   */
  readonly verify?: (config: ScaffoldConfig, outDir: string, context: RunContext) => Promise<VerifyResult>;
  /** Commands the user runs next, in order, shown when `verify` was not run. */
  readonly nextSteps?: (config: ScaffoldConfig) => string[];
}

/** The cross-stack questions a stack may or may not use. */
export interface StackCapabilities {
  /** "Monolith or microservices?" and the service names. */
  microservices: boolean;
  /** "What is your port?" */
  port: boolean;
  /** "Include a starter test project?" */
  tests: boolean;
  /** `--jwt`: JWT authentication boilerplate. */
  jwt: boolean;
  /** `--four-layer` / `--three-layer`: multi-module layer count. */
  layers: boolean;
}

/** The cross-stack questions default to "used"; the stack-specific flags (jwt, layers) to "not used". */
export const DEFAULT_CAPABILITIES: StackCapabilities = { microservices: true, port: true, tests: true, jwt: false, layers: false };

/** The capabilities of `adapter`, with anything it did not declare defaulting to "used". */
export function capabilitiesOf(adapter: StackAdapter): StackCapabilities {
  return { ...DEFAULT_CAPABILITIES, ...adapter.capabilities };
}

/**
 * What the engine hands a long-running phase: a way to say what it is doing, and a way to
 * learn it should stop. Passed in rather than imported so an adapter stays testable
 * without a terminal, and so cancellation is a value, not a global.
 */
export interface RunContext {
  /** Aborted when the user cancels (Ctrl-C). Pass it to runCommand so child processes die too. */
  readonly signal: AbortSignal;
  /** Names the current step ("installing packages"). Shown with elapsed time. */
  step(label: string): void;
}

/** For callers with no terminal and no one to cancel them: tests and scripts. */
export const noopContext: RunContext = { signal: new AbortController().signal, step: () => {} };
