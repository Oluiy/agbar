import { isTestPath } from "./fileKinds.js";
import type { DetectedFinding, RepoSnapshot, Rule } from "./types.js";

/**
 * Inline suppression - so someone who disagrees with one finding can silence
 * that finding instead of uninstalling the tool:
 *
 *   // agbar-ignore-next-line http-without-timeout
 *   # agbar-ignore-file no-rate-limiting, no-healthcheck
 *
 * Matched anywhere on a line, so it works in every comment syntax. A rule id is
 * required - there is no blanket "ignore everything", because the cost of a
 * suppression is that it can hide a real problem, and naming the rule keeps
 * that decision deliberate. Every suppression that hid a finding is counted and
 * shown in the report for the same reason.
 *
 * Rules never see suppressions. Each rule runs against a *view* of the repo with
 * its suppressed lines blanked (or files dropped), so adding a rule never means
 * remembering to honour a comment.
 */

export interface Suppression {
  relPath: string;
  /** 1-based line of the directive itself. */
  line: number;
  scope: "next-line" | "file";
  ruleIds: string[];
}

/**
 * Must be a comment on its own line - `//`, `#`, `--`, `/*` or `<!--` first. Text
 * that merely mentions a directive (a string in a test, a doc comment showing
 * the syntax) doesn't suppress anything: agbar's own test fixtures were
 * being read as suppressions, with a warning about a rule id inside a string.
 */
const DIRECTIVE = /^\s*(?:\/\/|#|--|\/\*|<!--|\{\/\*)\s*agbar-ignore-(next-line|file)\s+([a-z0-9-]+(?:\s*,\s*[a-z0-9-]+)*)/;

export function findSuppressions(repo: RepoSnapshot): Suppression[] {
  const found: Suppression[] = [];
  for (const file of repo.files) {
    // Test files are never graded, so a directive there can only be a fixture.
    if (isTestPath(file.relPath) || !file.content.includes("agbar-ignore-")) continue;
    file.content.split("\n").forEach((text, i) => {
      const m = DIRECTIVE.exec(text);
      if (m) found.push({ relPath: file.relPath, line: i + 1, scope: m[1] as Suppression["scope"], ruleIds: m[2].split(/\s*,\s*/) });
    });
  }
  return found;
}

/** The repo as `ruleId` should see it: suppressed lines blanked (line numbers kept), suppressed files dropped. */
export function viewForRule(repo: RepoSnapshot, ruleId: string, suppressions: Suppression[]): RepoSnapshot {
  const mine = suppressions.filter((s) => s.ruleIds.includes(ruleId));
  if (mine.length === 0) return repo;

  const files = repo.files.flatMap((file) => {
    const here = mine.filter((s) => s.relPath === file.relPath);
    if (here.length === 0) return [file];
    if (here.some((s) => s.scope === "file")) return [];
    const lines = file.content.split("\n");
    // s.line is 1-based, so as a 0-based index it already points at the next line.
    for (const s of here) if (s.line < lines.length) lines[s.line] = "";
    return [{ ...file, content: lines.join("\n") }];
  });
  return { ...repo, files };
}

export type RuleOutcome =
  { status: "skipped" } | { status: "passed" } | { status: "finding"; finding: DetectedFinding } | { status: "suppressed"; finding: DetectedFinding };

/**
 * Runs one rule honouring suppressions. "suppressed" means the rule would have
 * reported something on the real repo but didn't on the suppressed view - which
 * is exactly what the report needs to count.
 */
export function runRule(rule: Rule, repo: RepoSnapshot, suppressions: Suppression[]): RuleOutcome {
  const view = viewForRule(repo, rule.id, suppressions);
  const detected = rule.appliesTo(view) ? rule.detect(view) : undefined;
  if (detected) return { status: "finding", finding: detected };

  if (view !== repo && rule.appliesTo(repo)) {
    const original = rule.detect(repo);
    if (original) return { status: "suppressed", finding: original };
  }
  return rule.appliesTo(view) ? { status: "passed" } : { status: "skipped" };
}

/** "path:line" of every directive naming a rule that doesn't exist - it suppresses nothing, which the author should know. */
export function unknownRuleSuppressions(suppressions: Suppression[], knownRuleIds: Set<string>): string[] {
  return suppressions.flatMap((s) => s.ruleIds.filter((id) => !knownRuleIds.has(id)).map((id) => `'${id}' at ${s.relPath}:${s.line}`));
}
