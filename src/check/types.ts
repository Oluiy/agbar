/**
 * `agbar check` grades an existing repo - code you may not have written, which
 * in 2026 is most of it - against the concepts in concepts.ts.
 *
 * Two rules this module holds itself to:
 *
 * 1. Every finding MUST link to a concept. A finding with nothing to teach is just
 *    a lint rule, and there are better linters. If a check has no concept behind it,
 *    it doesn't ship until the concept is written.
 * 2. These are heuristics over source text, not an AST or a type checker. They are
 *    tuned for low false positives and reported as "worth looking at," never as
 *    proof. Overstating certainty is how a tool like this loses trust on day one.
 *
 * Deliberately NOT supply-chain security scanning - OpenSSF Scorecard does that well,
 * for free, and rebuilding it would be a worse version of a solved problem.
 */

export type Severity = "high" | "medium" | "low";

export interface SourceFile {
  /** Path relative to the repo root, with forward slashes. */
  relPath: string;
  content: string;
}

export interface RepoSnapshot {
  root: string;
  /** Text source files, capped for performance. */
  files: SourceFile[];
  /** Every relative path found, including ones not read as source. */
  allPaths: string[];
  /** @deprecated kept for callers that only ever wanted the root file - prefer gitignores + isPathIgnored() for anything path-specific. */
  gitignore: string;
  /** Every .gitignore in the repo, keyed by its relative path, content unparsed. */
  gitignores: Record<string, string>;
  /** Dependency manifests concatenated, for "is this dependency present" checks. */
  manifests: string;
  hasDatabase: boolean;
  /** From `"kind"` in the repo's `.agbarrc`. Undefined = not declared; every rule runs. */
  kind?: ProjectKind;
  /** Folders ("" = root) whose package.json makes them a browser/mobile app with no server of its own (see manifests.ts). */
  frontendRoots?: string[];
}

/** operational: will this survive traffic? structural: can a person still change it? */
export type RuleKind = "operational" | "structural";

/** What a rule's detect() returns - kind and nextStep are rule-level constants, merged in by the runner rather than repeated in every detect() body. */
export interface DetectedFinding {
  ruleId: string;
  conceptId: string;
  severity: Severity;
  /** One line: what's wrong. */
  summary: string;
  /** Where it was seen, when the rule can point at something specific. */
  evidence?: string;
}

export interface Finding extends DetectedFinding {
  kind: RuleKind;
  /** A concrete action for THIS finding - distinct from the concept's general principle (shown via --explain). Static text keyed to the rule, never generated. */
  nextStep: string;
}

/** A rule as authored in operationalRules.ts/structuralRules.ts, before rules.ts tags it with its kind. */
export interface RuleDefinition {
  id: string;
  /** The concept that explains this finding. Required, by design. */
  conceptId: string;
  severity: Severity;
  /** What passing looks like, shown when the check passes. */
  passSummary: string;
  nextStep: string;
  /** Skip entirely when it can't apply - a repo with no database shouldn't be graded on pool config. */
  appliesTo: (repo: RepoSnapshot) => boolean;
  /** Return a finding when something's wrong, or undefined when the check passes. */
  detect: (repo: RepoSnapshot) => DetectedFinding | undefined;
  /**
   * Only meaningful for a deployed network service (rate limits, health checks,
   * pooling). Skipped when `.agbarrc` declares the project a cli, library,
   * or local-tool - a localhost dev UI doesn't need production advice.
   */
  serviceOnly?: boolean;
}

export const PROJECT_KINDS = ["service", "cli", "library", "local-tool"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

export interface Rule extends RuleDefinition {
  kind: RuleKind;
}

export interface CheckReport {
  findings: Finding[];
  passed: string[];
  skipped: string[];
  /** Service-only rules skipped because `.agbarrc` says this isn't a service. Subset of `skipped`. */
  skippedForKind?: string[];
  /** The declared project kind, echoed so the report can explain what it skipped. */
  kind?: ProjectKind;
  /** Findings hidden by a agbar-ignore comment - always shown as a count, since a suppression can hide a real problem. */
  suppressed?: { ruleId: string; evidence?: string }[];
  /** Suppression comments naming a rule that doesn't exist ("'x' at path:line") - they silence nothing. */
  unknownSuppressions?: string[];
}
