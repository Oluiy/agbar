import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { writeFile } from "../../utils/fsWrite.js";
import { parsePattern, RegexTimeout, REGEX_TIMEOUT_MS, safeExec } from "../regex/safeRegex.js";
import type { Challenge, CheckResult, Checker, RegexCases } from "../types.js";

/**
 * Grades a regex by what it does, case by case: must-match strings, must-reject
 * strings, and (for extraction) the capture groups produced. Every case gets a
 * line - green when right, red when wrong - so a learner sees *which* input their
 * pattern gets wrong and *what* it matched there, not just "failed".
 *
 * Runs in-process with a timeout (safeRegex.ts), so a catastrophic pattern is a
 * graded failure instead of a frozen terminal.
 */

const INSTRUCTIONS = "# Write your pattern on the first line that isn't a comment.\n# Bare (\\d{5}) or with flags (/\\d{5}/i). JavaScript regex syntax.\n";

/** Lines starting with "# " (or a lone "#") are instructions; a pattern like #[0-9a-f]{6} is kept. */
function patternLine(text: string): string | undefined {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .find((l) => l.trim() !== "" && !/^#( |$)/.test(l));
}

const show = (s: string) => JSON.stringify(s.length > 40 ? `${s.slice(0, 37)}...` : s);

export function parseRegexCases(raw: unknown, where: string): RegexCases {
  const r = (raw ?? {}) as Record<string, unknown>;
  const strings = (v: unknown, field: string): string[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new Error(`${where}: regex_cases.${field} must be a list of strings.`);
    return v as string[];
  };
  const cases: RegexCases = { matches: strings(r.matches, "matches"), rejects: strings(r.rejects, "rejects") };
  if (r.captures !== undefined) {
    if (!Array.isArray(r.captures)) throw new Error(`${where}: regex_cases.captures must be a list.`);
    cases.captures = r.captures.map((c, i) => {
      const e = c as Record<string, unknown>;
      if (typeof e.input !== "string") throw new Error(`${where}: regex_cases.captures[${i}] needs an 'input' string.`);
      return { input: e.input, groups: strings(e.groups, `captures[${i}].groups`) };
    });
  }
  if (cases.matches.length + cases.rejects.length + (cases.captures?.length ?? 0) === 0) {
    throw new Error(`${where}: check_type 'regex_cases' needs at least one of matches / rejects / captures - otherwise any pattern passes.`);
  }
  return cases;
}

export const regexChecker: Checker = {
  solutionPath(workspaceDir: string): string {
    return path.join(workspaceDir, "pattern.txt");
  },

  scaffold(challenge: Challenge, workspaceDir: string): void {
    const file = this.solutionPath(workspaceDir, challenge);
    if (!existsSync(file)) writeFile(file, `${INSTRUCTIONS}${challenge.starterCode}`);
  },

  async run(challenge: Challenge, workspaceDir: string): Promise<CheckResult> {
    const cases = challenge.regexCases;
    if (challenge.checkType !== "regex_cases" || !cases) {
      return { passed: false, message: `The regex checker needs check_type 'regex_cases' (challenge '${challenge.id}').` };
    }
    const line = patternLine(readFileSync(this.solutionPath(workspaceDir, challenge), "utf-8"));
    if (!line) return { passed: false, message: "pattern.txt has no pattern yet - write it on the first non-comment line." };

    let re: RegExp;
    try {
      re = parsePattern(line);
    } catch (err) {
      return { passed: false, message: `That pattern doesn't compile: ${(err as Error).message}` };
    }

    const out: string[] = [];
    let failed = 0;
    const record = (ok: boolean, text: string) => {
      if (!ok) failed++;
      out.push(ok ? pc.green(`  ✓ ${text}`) : pc.red(`  ✗ ${text}`));
    };
    const attempt = (input: string): RegExpExecArray | null | "timeout" => {
      try {
        return safeExec(re, input);
      } catch (err) {
        if (err instanceof RegexTimeout) return "timeout";
        throw err;
      }
    };
    const timeoutText = (input: string) => `gave up after ${REGEX_TIMEOUT_MS}ms on ${show(input)} - catastrophic backtracking`;

    for (const input of cases.matches) {
      const m = attempt(input);
      if (m === "timeout") record(false, timeoutText(input));
      else record(m !== null, m ? `matches ${show(input)}` : `should match ${show(input)}, but doesn't`);
    }
    for (const input of cases.rejects) {
      const m = attempt(input);
      if (m === "timeout") record(false, timeoutText(input));
      // Showing WHAT matched is the lesson: "123456" matched as "12345" means no anchors.
      else record(m === null, m ? `should reject ${show(input)}, but matched ${show(m[0])} inside it` : `rejects ${show(input)}`);
    }
    for (const c of cases.captures ?? []) {
      const m = attempt(c.input);
      if (m === "timeout") {
        record(false, timeoutText(c.input));
        continue;
      }
      const got = m ? m.slice(1).map((g) => g ?? "") : null;
      const ok = got !== null && JSON.stringify(got) === JSON.stringify(c.groups);
      record(
        ok,
        ok
          ? `captures ${JSON.stringify(c.groups)} from ${show(c.input)}`
          : `on ${show(c.input)}: expected groups ${JSON.stringify(c.groups)}, got ${got ? JSON.stringify(got) : "no match"}`
      );
    }

    const total = out.length;
    return failed === 0
      ? { passed: true, message: `All ${total} cases right:\n${out.join("\n")}` }
      : { passed: false, message: `${failed} of ${total} cases wrong:\n${out.join("\n")}` };
  },
};
