import { readFileSync } from "node:fs";
import type { ScaffoldConfig } from "./config.js";
import type { StackAdapter } from "./stacks/StackAdapter.js";
import { isValidIdentifierName } from "./utils/nameValidation.js";

/** Raw CLI flags as commander hands them back (see cli.ts for the option definitions). */
export interface NonInteractiveFlags {
  config?: string;
  stack?: string;
  structure?: string;
  fourLayer?: boolean;
  threeLayer?: boolean;
  db?: string;
  jwt?: boolean;
  docker?: boolean;
  tests?: boolean; // commander's --no-tests negation defaults this to true - see the direct argv check below for why that alone isn't enough.
  microservice?: boolean;
  services?: string;
  port?: string;
  llmApi?: boolean;
}

/** The shape of a --config JSON file. Every field is optional; CLI flags override whatever's here. */
interface ConfigFileShape {
  projectName?: string;
  stack?: string;
  /** Where the project folder is created. Defaults to the current directory. */
  outputDirectory?: string;
  isMicroservice?: boolean;
  serviceNames?: string[];
  includeTests?: boolean;
  httpPort?: number;
  usesLlmApi?: boolean;
  addons?: Record<string, unknown>;
}

function loadConfigFile(path: string): ConfigFileShape {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    throw new Error(`Couldn't read config file '${path}': ${(err as Error).message}`);
  }
  let parsed: ConfigFileShape;
  try {
    parsed = JSON.parse(raw) as ConfigFileShape;
  } catch (err) {
    throw new Error(`Config file '${path}' isn't valid JSON: ${(err as Error).message}`);
  }

  // A misspelled or unsupported key used to be ignored in silence, which meant a
  // config that asked for one thing and got another while still reporting success.
  // Stack-specific settings belong under "addons", which each adapter validates.
  const known = new Set(["projectName", "stack", "outputDirectory", "isMicroservice", "serviceNames", "includeTests", "httpPort", "usesLlmApi", "addons"]);
  const unknown = Object.keys(parsed as Record<string, unknown>).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw new Error(
      `Config file '${path}' has unknown key(s): ${unknown.join(", ")}. Known keys: ${[...known].join(", ")}. Stack-specific settings go under "addons".`
    );
  }
  return parsed;
}

/**
 * Resolves a full ScaffoldConfig + StackAdapter from CLI flags and/or a
 * --config JSON file, with zero prompts - the path that makes CI and
 * automated testing possible. Flags win over the config file's own values
 * when both are given for the same setting. Throws a specific, actionable
 * error on anything invalid or missing rather than silently defaulting - a
 * scripted run should fail loudly, not generate something nobody asked for.
 */
export function resolveNonInteractive(
  stacks: StackAdapter[],
  flags: NonInteractiveFlags,
  projectNameArg?: string
): { config: ScaffoldConfig; adapter: StackAdapter } {
  const fileConfig = flags.config ? loadConfigFile(flags.config) : {};

  const projectName = (projectNameArg ?? fileConfig.projectName ?? "").trim();
  if (!projectName) {
    throw new Error('A project name is required in non-interactive mode: pass it as an argument, or set "projectName" in --config.');
  }
  if (!isValidIdentifierName(projectName)) {
    throw new Error(`'${projectName}' isn't a valid project name. Use only letters, digits, and underscores, starting with a letter.`);
  }

  const stackId = flags.stack ?? fileConfig.stack;
  if (!stackId) {
    throw new Error(
      `A stack is required in non-interactive mode: pass --stack <id>, or set "stack" in --config. Available: ${stacks.map((s) => s.id).join(", ")}.`
    );
  }
  const adapter = stacks.find((s) => s.id === stackId);
  if (!adapter) {
    throw new Error(`Unknown stack '${stackId}'. Available: ${stacks.map((s) => s.id).join(", ")}.`);
  }
  if (adapter.supportsNonInteractive === false) {
    throw new Error(
      `'${adapter.label}' can't run non-interactively yet - it hands off to another program's own interactive prompts. Run 'buildquick' without --yes/--config to use it.`
    );
  }

  const serviceNames = flags.services
    ? flags.services
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : (fileConfig.serviceNames ?? []);
  // Naming services without also passing --microservice would otherwise
  // silently generate a monolith and ignore the names entirely.
  const isMicroservice = flags.microservice ?? fileConfig.isMicroservice ?? serviceNames.length > 0;
  if (isMicroservice && serviceNames.length === 0) {
    throw new Error('Microservice mode needs at least one service name: pass --services name1,name2, or set "serviceNames" in --config.');
  }
  for (const name of serviceNames) {
    if (!isValidIdentifierName(name)) {
      throw new Error(`Service name '${name}' isn't valid. Use only letters, digits, and underscores, starting with a letter.`);
    }
  }

  // commander's --no-tests negation makes flags.tests default to `true` even
  // when the flag was never mentioned, so it alone can't distinguish "user
  // said yes" from "user said nothing" - checking argv directly for the one
  // flag that can actually appear sidesteps that ambiguity.
  const noTestsPassed = process.argv.includes("--no-tests");
  const includeTests = noTestsPassed ? false : (fileConfig.includeTests ?? true);

  const portRaw = flags.port ?? fileConfig.httpPort;
  const httpPort = portRaw !== undefined ? Number(portRaw) : 8080;
  if (!Number.isInteger(httpPort) || httpPort <= 0) {
    throw new Error(`Invalid port '${portRaw}': must be a positive integer.`);
  }

  const usesLlmApi = flags.llmApi ?? fileConfig.usesLlmApi ?? false;

  // Merge config-file addons with the handful of top-level convenience flags
  // that map to common addon keys; flags win when both are present. Anything
  // an adapter-specific flag doesn't cover is still reachable via --config's
  // "addons" object directly.
  const rawAddons: Record<string, unknown> = { ...(fileConfig.addons ?? {}) };
  if (flags.structure !== undefined) rawAddons.structure = flags.structure;
  if (flags.fourLayer) rawAddons.isFourLayer = true;
  if (flags.threeLayer) rawAddons.isFourLayer = false;
  if (flags.db !== undefined) rawAddons.dbProvider = flags.db;
  if (flags.jwt) rawAddons.includeJwt = true;
  if (flags.docker) rawAddons.includeDocker = true;

  const addons = adapter.resolveAddons(rawAddons);

  const config: ScaffoldConfig = {
    projectName,
    outputDirectory: fileConfig.outputDirectory ?? process.cwd(),
    includeTests,
    isMicroservice,
    serviceNames,
    httpPort,
    usesLlmApi,
    addons,
  };

  return { config, adapter };
}
