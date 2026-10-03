import { RULES } from "./rules.js";
import { redactSecrets } from "./redact.js";
import { adviceFor } from "./stackAdvice.js";
import { findSuppressions, runRule, unknownRuleSuppressions } from "./suppression.js";
import type { CheckReport, Rule, RepoSnapshot, Severity } from "./types.js";

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/**
 * Runs every applicable rule. A rule that can't apply (pool config on a repo with
 * no database) is skipped rather than counted as a failure - grading a project on
 * something it has no reason to do is how a checker earns a reputation for noise.
 */
export function runCheck(repo: RepoSnapshot, rules: Rule[] = RULES): CheckReport {
  const report: CheckReport = { findings: [], passed: [], skipped: [], skippedForKind: [], kind: repo.kind, suppressed: [] };
  const notAService = repo.kind !== undefined && repo.kind !== "service";
  const suppressions = findSuppressions(repo);
  report.unknownSuppressions = unknownRuleSuppressions(suppressions, new Set(rules.map((r) => r.id)));

  for (const rule of rules) {
    if (rule.serviceOnly && notAService) {
      report.skipped.push(rule.id);
      report.skippedForKind!.push(rule.id);
      continue;
    }
    const outcome = runRule(rule, repo, suppressions);
    if (outcome.status === "finding") {
      const evidence = outcome.finding.evidence === undefined ? undefined : redactSecrets(outcome.finding.evidence);
      report.findings.push({ ...outcome.finding, evidence, kind: rule.kind, nextStep: adviceFor(rule, repo, outcome.finding) });
    } else if (outcome.status === "suppressed")
      report.suppressed!.push({ ruleId: rule.id, evidence: outcome.finding.evidence === undefined ? undefined : redactSecrets(outcome.finding.evidence) });
    else if (outcome.status === "passed") report.passed.push(rule.id);
    else report.skipped.push(rule.id);
  }

  report.findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return report;
}
