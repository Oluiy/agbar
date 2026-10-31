import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { writeFile } from "../utils/fsWrite.js";
import { codeFiles } from "./repo.js";
import type { CheckReport, Finding, RepoSnapshot } from "./types.js";

/**
 * Turns "this finding is wrong" or "this stack isn't recognized at all" into a
 * one-command report - the same thing a user would otherwise have to write up
 * by hand (as happened with the db-guard false positives). Deliberately manual
 * and local: no server, no silent network calls, nothing leaves the machine
 * until the user's own mail client sends it. See the planning thread for why -
 * a tool that tells users to judge its findings themselves shouldn't quietly
 * judge them in the background.
 */

// Rules whose appliesTo() depends on recognizing a specific stack (a web
// framework, a database driver, a session library). If every one of these is
// "not applicable" on a repo that clearly has real code, that's the checker
// admitting it doesn't understand this stack - not the rules being correctly
// quiet, the way e.g. no-connection-pool-config is on a repo with no database.
// New stack-specific rules need adding here too.
const STACK_SPECIFIC_RULE_IDS = [
  "no-rate-limiting",
  "no-healthcheck",
  "no-connection-pool-config",
  "no-circuit-breaker",
  "in-memory-session-store",
  "unbounded-list-query",
  "query-in-loop",
  "http-without-timeout",
  "handler-touches-database",
];

/** True when there's real code here but nothing stack-specific ever engaged - a gap in what agbar recognizes, not a passing grade. */
export function isUnrecognizedStack(repo: RepoSnapshot, report: CheckReport): boolean {
  return codeFiles(repo).length > 0 && STACK_SPECIFIC_RULE_IDS.every((id) => report.skipped.includes(id));
}

interface GapReport {
  kind: "finding" | "unrecognized-stack";
  timestamp: string;
  note?: string;
  finding?: { ruleId: string; conceptId: string; severity: string; summary: string; evidence?: string };
  stackSignals?: { extensions: string[]; hasDatabase: boolean };
}

function stackSignals(repo: RepoSnapshot): GapReport["stackSignals"] {
  const extensions = [...new Set(codeFiles(repo).map((f) => path.extname(f.relPath)))].sort();
  return { extensions, hasDatabase: repo.hasDatabase };
}

/** Builds the report content - metadata only (rule id, stack signals) unless includeEvidence is explicitly passed, since evidence is a line from the user's own source. */
export function buildGapReport(
  repo: RepoSnapshot,
  report: CheckReport,
  findingIndex: number | undefined,
  note: string | undefined,
  includeEvidence: boolean
): GapReport | { error: string } {
  if (findingIndex !== undefined) {
    const finding: Finding | undefined = report.findings[findingIndex - 1];
    if (!finding) return { error: `No finding #${findingIndex} - this run has ${report.findings.length}.` };
    return {
      kind: "finding",
      timestamp: new Date().toISOString(),
      note,
      finding: {
        ruleId: finding.ruleId,
        conceptId: finding.conceptId,
        severity: finding.severity,
        summary: finding.summary,
        evidence: includeEvidence ? finding.evidence : undefined,
      },
    };
  }

  if (isUnrecognizedStack(repo, report)) {
    return { kind: "unrecognized-stack", timestamp: new Date().toISOString(), note, stackSignals: stackSignals(repo) };
  }

  return { error: "Nothing to report: pass a finding number (--report-gap 3), or this stack was already recognized." };
}

function renderGapReport(gap: GapReport): string {
  const lines = [`# agbar gap report`, ``, `kind: ${gap.kind}`, `timestamp: ${gap.timestamp}`];
  if (gap.note) lines.push(``, `note: ${gap.note}`);
  if (gap.finding) {
    lines.push(``, `## Finding`, JSON.stringify(gap.finding, null, 2));
  }
  if (gap.stackSignals) {
    lines.push(``, `## Stack signals`, JSON.stringify(gap.stackSignals, null, 2));
  }
  return lines.join("\n") + "\n";
}

/**
 * Writes the report locally regardless of whether the user goes on to email
 * it - a record survives even if they close the mail client without sending.
 * dirOverride is injectable so tests never touch the real home directory, the
 * same DI convention progress.ts already uses.
 */
export function writeGapReportFile(gap: GapReport, dirOverride?: string): string {
  const dir = dirOverride ?? path.join(os.homedir(), ".agbar", "gap-reports");
  const file = path.join(dir, `${gap.timestamp.replace(/[:.]/g, "-")}.md`);
  writeFile(file, renderGapReport(gap));
  return file;
}

const REPORT_TO_EMAIL = "akinboyewaiyanuoluwa15@gmail.com";

export function buildMailto(gap: GapReport): string {
  const subject = gap.kind === "finding" ? `agbar: finding may be wrong (${gap.finding?.ruleId})` : `agbar: unrecognized stack`;
  const body = renderGapReport(gap);
  return `mailto:${REPORT_TO_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Best-effort - if there's no GUI/mail client (CI, SSH session), the caller still has the file written above. */
export function openInBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(command, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
  } catch {
    // Silently fall through - the report file on disk is the fallback.
  }
}
