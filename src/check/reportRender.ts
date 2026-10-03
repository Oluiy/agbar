import pc from "picocolors";
import { BACKEND_CONCEPTS } from "../concepts/index.js";
import { command } from "../ui/palette.js";
import { RULES } from "./rules.js";
import type { CheckReport, Finding, RuleKind, Severity } from "./types.js";

/**
 * Pure string-building for `buildquick check`'s output - kept out of
 * checkCommand.ts so that file stays scan-run-print, and this stays testable
 * without capturing console.log.
 */

const SEVERITY_COLOR: Record<Severity, (s: string) => string> = {
  high: pc.red,
  medium: pc.yellow,
  low: pc.cyan,
};

const SECTION_LABEL: Record<RuleKind, string> = {
  operational: "Will this survive traffic?",
  structural: "Can this be changed later?",
};

function conceptFix(conceptId: string): string | undefined {
  // Rules can't ship without a real conceptId (enforced by a test), so this
  // only fails to resolve if that invariant is ever broken.
  return BACKEND_CONCEPTS.find((c) => c.id === conceptId)?.fix;
}

const KINDS: RuleKind[] = ["operational", "structural"];

/** Rendering order (operational section first, then structural) - the same order findings get numbered in, so "#3" means the same thing everywhere in the output. */
function orderedFindings(findings: Finding[]): Finding[] {
  return KINDS.flatMap((kind) => findings.filter((f) => f.kind === kind));
}

/** "3 high · 2 medium · 1 low" - a one-line count to gauge urgency before reading the detail below it. Zero-count severities are omitted, not shown as "0 low". */
function severityCounts(findings: Finding[]): string {
  const order: Severity[] = ["high", "medium", "low"];
  return order
    .map((sev) => ({ sev, n: findings.filter((f) => f.severity === sev).length }))
    .filter(({ n }) => n > 0)
    .map(({ sev, n }) => SEVERITY_COLOR[sev](`${n} ${sev}`))
    .join(pc.dim(" · "));
}

/**
 * Colour carries meaning, consistently: severity badge (red/yellow/cyan), where
 * (blue), what to do (green), a command to run (cyan), fine print (dim). The
 * action line used to be dimmed like fine print - the one line a beginner most
 * needs was the easiest to skip.
 */
const BADGE: Record<Severity, (s: string) => string> = {
  high: (s) => pc.bold(pc.bgRed(pc.white(` ${s} `))),
  medium: (s) => pc.bold(pc.yellow(` ${s} `)),
  low: (s) => pc.cyan(` ${s} `),
};

function renderFinding(f: Finding, index: number, explain: boolean): string {
  const indent = "        ";
  const lines: string[] = [];
  const summary = f.severity === "high" ? pc.bold(f.summary) : f.summary;
  lines.push(`${pc.dim(`${index}.`)} ${BADGE[f.severity](f.severity.toUpperCase().padEnd(6))} ${summary}`);
  if (f.evidence) lines.push(`${indent}${pc.dim("where:")} ${pc.blue(f.evidence)}`);
  lines.push(`${indent}${pc.bold(pc.green("Next:"))} ${f.nextStep}`);
  if (explain) {
    const fix = conceptFix(f.conceptId);
    if (fix) lines.push(`${indent}${pc.green("Why it works:")} ${fix}`);
  }
  lines.push(`${indent}${pc.dim("Learn why:")} ${command(`buildquick concepts ${f.conceptId}`)}`);
  return lines.join("\n");
}

/** Findings grouped into the two sections operationalRules.ts/structuralRules.ts already split the rules into, numbered in that same order. A kind with nothing to report is omitted rather than shown empty. */
function renderSections(findings: Finding[], explain: boolean): string {
  const numbered = new Map(orderedFindings(findings).map((f, i) => [f, i + 1]));
  return KINDS.map((kind) => ({ kind, group: findings.filter((f) => f.kind === kind) }))
    .filter(({ group }) => group.length > 0)
    .map(({ kind, group }) => `${pc.bold(pc.underline(SECTION_LABEL[kind]))}\n\n${group.map((f) => renderFinding(f, numbered.get(f)!, explain)).join("\n\n")}`)
    .join("\n\n");
}

const SERVICE_ONLY = new Set(RULES.filter((r) => r.serviceOnly).map((r) => r.id));

/**
 * Either confirms which production-service checks a declared kind skipped, or -
 * when service-only findings appear and nothing was declared - tells the user
 * how to say "this isn't a deployed service". Empty when neither applies.
 */
function kindNote(report: CheckReport): string {
  if (report.kind && report.kind !== "service") {
    const n = report.skippedForKind?.length ?? 0;
    return n > 0 ? `${pc.magenta(`${n} production-service check(s) skipped: .buildquickrc says this is a ${report.kind}.`)}\n` : "";
  }
  if (!report.kind && report.findings.some((f) => SERVICE_ONLY.has(f.ruleId))) {
    return `${pc.magenta('Not a deployed service (a CLI, library, or local tool)? Add {"kind": "cli"} to .buildquickrc to skip service-only checks.')}\n`;
  }
  return "";
}

/**
 * Suppressions are always visible, never silent: a suppression can hide a real
 * problem, so "all clear" must say what it isn't showing. Unknown rule ids get
 * their own warning - a typo'd suppression silences nothing, and its author
 * deserves to know that.
 */
function suppressionNote(report: CheckReport): string {
  const lines: string[] = [];
  const hidden = report.suppressed ?? [];
  if (hidden.length > 0) {
    lines.push(pc.yellow(`${hidden.length} finding(s) hidden by buildquick-ignore comments:`));
    for (const s of hidden) lines.push(pc.yellow(`  ${s.ruleId}${s.evidence ? `  ${s.evidence.split(/\s{2}/)[0]}` : ""}`));
  }
  for (const u of report.unknownSuppressions ?? []) {
    lines.push(pc.red(`Suppression names an unknown rule ${u} - it silences nothing.`));
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}

export function renderCheckReport(report: CheckReport, root: string, explain: boolean): string {
  const applicable = report.passed.length + report.findings.length;
  // Defensive only: committed-private-key applies unconditionally, and the
  // structural rules apply to any code file, so in practice this never fires
  // for a directory that has any files at all. checkCommand.ts short-circuits
  // the genuinely-empty case before runCheck() ever runs.
  if (applicable === 0) {
    return pc.dim(`\nNothing to check in ${root} - no rules were applicable.`);
  }

  const header = pc.bold(`\n${report.passed.length}/${applicable} checks passed`) + pc.dim(`  (${report.skipped.length} not applicable)`);

  if (report.findings.length === 0) {
    // The kind note matters most here: "all clear" must not hide that five
    // checks were never run.
    return `${header}\n\n${pc.green("Nothing flagged. Every applicable check passed.")}\n${suppressionNote(report)}${kindNote(report)}`.trimEnd();
  }

  // Counts first, so severity is legible at a glance before scrolling through
  // every finding - matters more as the rule set grows past a handful.
  const counts = `\n${severityCounts(report.findings)}`;
  const body = renderSections(report.findings, explain);

  const footer = [
    "These are text heuristics, not proof - each one is worth looking at, not blindly fixing.",
    !explain ? "Run with --explain to include the fix for each concept inline." : undefined,
    "For supply-chain and repo security health, pair this with OpenSSF Scorecard (scorecard.dev) - it covers what this deliberately doesn't.",
  ]
    .filter(Boolean)
    .map((line) => pc.dim(line))
    .join("\n");

  // One concrete place to begin. Numbering groups by section, so #1 isn't always
  // the most severe - find the most severe finding and name ITS number.
  const ordered = orderedFindings(report.findings);
  const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  const first = ordered.reduce((best, f) => (rank[f.severity] < rank[best.severity] ? f : best), ordered[0]);
  const startHere = `${pc.bold(`Start with #${ordered.indexOf(first) + 1}`)} - it's the most serious. ${command(`buildquick concepts ${first.conceptId}`)} explains why it matters.\n\n`;
  return `${header}${counts}\n\n${body}\n\n${startHere}${suppressionNote(report)}${kindNote(report)}${footer}`;
}

/** A pasteable checklist instead of the narrative report - for turning a check run into a worklist. Accepts the same --explain flag as the narrative report, so combining the two flags doesn't silently drop one. Numbered the same way renderCheckReport is, so "#3" means the same finding in either output. */
export function renderFixPlan(report: CheckReport, explain: boolean): string {
  if (report.findings.length === 0) return "Nothing to fix - every applicable check passed.";

  const numbered = new Map(orderedFindings(report.findings).map((f, i) => [f, i + 1]));

  return KINDS.map((kind) => {
    const group = report.findings.filter((f) => f.kind === kind);
    if (group.length === 0) return undefined;
    const items = group
      .map((f) => {
        const fix = explain ? conceptFix(f.conceptId) : undefined;
        return `- [ ] #${numbered.get(f)} (${f.severity}) ${f.summary}${f.evidence ? ` \`${f.evidence}\`` : ""}\n      ${f.nextStep}${fix ? `\n      ${fix}` : ""}`;
      })
      .join("\n");
    return `## ${SECTION_LABEL[kind]}\n\n${items}`;
  })
    .filter(Boolean)
    .join("\n\n");
}
