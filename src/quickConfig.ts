import type { ScaffoldConfig } from "./config.js";
import type { StackAdapter } from "./stacks/StackAdapter.js";

/** True when asking is pointless: the stack either has no addon questions we can skip, or hands off to its own prompts. */
export function supportsQuickDefaults(adapter: StackAdapter): boolean {
  return adapter.supportsNonInteractive !== false;
}

/**
 * What the shortcut would pick, in words: "structure: layered, orm: prisma, db: sqlite". Shown in
 * the question so choosing the shortcut never hides a decision (the ORM, for one) from the user.
 */
export function describeDefaults(adapter: StackAdapter): string {
  return Object.entries(adapter.resolveAddons({}))
    .filter(([key, value]) => key !== "install" && typeof value === "string")
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(", ");
}

/**
 * The "use recommended defaults" configuration. The stack's own `resolveAddons({})` is the
 * single definition of its sensible choices (the same one `--yes` uses), so the quick path
 * and the scripted path can never drift apart. Installing is off: scaffolding is instant,
 * and installing is the user's separate, deliberate step.
 */
export function quickConfig(adapter: StackAdapter, projectName: string, outputDirectory: string): ScaffoldConfig {
  return {
    projectName,
    outputDirectory,
    includeTests: true,
    isMicroservice: false,
    serviceNames: [],
    httpPort: 8080,
    usesLlmApi: false,
    addons: { ...adapter.resolveAddons({}), install: false },
  };
}
