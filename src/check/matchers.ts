import path from "node:path";
import { codeFiles, isClientCode, isTestLine } from "./fileKinds.js";
import { blankLiterals } from "./literals.js";
import type { RepoSnapshot, SourceFile } from "./types.js";

/**
 * How rules search a repo. Two families, and choosing the right one matters:
 *
 * - Code-only (firstMatch, anyCodeMatches, lineMatchesCode): for something being
 *   DONE - a call, a server, a client. Matches starting inside a string or
 *   comment don't count (see literals.ts).
 * - Raw text (firstTextMatch, anyTextMatches): for things that ARE text - SQL,
 *   URLs, key material, "/health" - and for presence evidence that only ever
 *   suppresses a finding.
 */

const blanked = new WeakMap<SourceFile, string[]>();

/** A code file's lines with string literals and comments blanked, cached per file. Same line count as the raw file. */
export function codeLines(file: SourceFile): string[] {
  let lines = blanked.get(file);
  if (!lines) {
    lines = blankLiterals(file.content, path.extname(file.relPath).toLowerCase()).split("\n");
    blanked.set(file, lines);
  }
  return lines;
}

function globalCopy(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
}

/**
 * Index of the first line where `pattern` matches *in code* - the match starts
 * at a character that is not inside a string or comment. Matching still runs on
 * the raw line, so a pattern like `app.get("/` can see the quote it needs, but a
 * match that *begins* inside a literal ("axios.get" in a lookup table) is ignored.
 */
function firstCodeLine(file: SourceFile, pattern: RegExp): number {
  const raw = file.content.split("\n");
  const code = codeLines(file);
  const re = globalCopy(pattern);
  for (let i = 0; i < raw.length; i++) {
    if (isTestLine(file, i)) break; // everything after #[cfg(test)] is test code
    re.lastIndex = 0;
    for (let m = re.exec(raw[i]); m; m = re.exec(raw[i])) {
      if (code[i][m.index] === raw[i][m.index]) return i;
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return -1;
}

/** True when `line` of `file` matches `pattern` starting in code, not inside a literal. For rules that walk lines themselves. */
export function lineMatchesCode(file: SourceFile, lineIndex: number, pattern: RegExp): boolean {
  if (isTestLine(file, lineIndex)) return false;
  const rawLine = file.content.split("\n")[lineIndex] ?? "";
  const codeLine = codeLines(file)[lineIndex] ?? "";
  const re = globalCopy(pattern);
  for (let m = re.exec(rawLine); m; m = re.exec(rawLine)) {
    if (codeLine[m.index] === rawLine[m.index]) return true;
    if (m[0].length === 0) re.lastIndex++;
  }
  return false;
}

/** True when any dependency manifest mentions one of these. */
export function dependsOnAny(repo: RepoSnapshot, needles: string[]): boolean {
  return needles.some((n) => repo.manifests.includes(n.toLowerCase()));
}

/** First match of `pattern` *in code*, as "path:line" plus the trimmed line. */
export function firstMatch(repo: RepoSnapshot, pattern: RegExp): string | undefined {
  for (const file of codeFiles(repo)) {
    const i = firstCodeLine(file, pattern);
    if (i !== -1) return `${file.relPath}:${i + 1}  ${file.content.split("\n")[i].trim().slice(0, 100)}`;
  }
  return undefined;
}

/** Server-side code that makes outbound calls - browser fetches to the page's own backend excluded. */
export function anyServerCodeMatches(repo: RepoSnapshot, pattern: RegExp): boolean {
  return codeFiles(repo).some((f) => !isClientCode(repo, f) && firstCodeLine(f, pattern) !== -1);
}

/** True when any code file matches `pattern` in code, not inside a string or comment. */
export function anyCodeMatches(repo: RepoSnapshot, pattern: RegExp): boolean {
  return codeFiles(repo).some((f) => firstCodeLine(f, pattern) !== -1);
}

/** Raw-text first match, strings and comments included. */
export function firstTextMatch(repo: RepoSnapshot, pattern: RegExp): string | undefined {
  for (const file of codeFiles(repo)) {
    const lines = file.content.split("\n");
    const i = lines.findIndex((l, idx) => !isTestLine(file, idx) && pattern.test(l));
    if (i !== -1) return `${file.relPath}:${i + 1}  ${lines[i].trim().slice(0, 100)}`;
  }
  return undefined;
}

export function anyTextMatches(repo: RepoSnapshot, pattern: RegExp): boolean {
  return codeFiles(repo).some((f) => pattern.test(f.content));
}

/** Line count per code file - the raw data behind "how does this file compare to the rest of the repo," not just a threshold. */
export function fileLineCounts(repo: RepoSnapshot): { relPath: string; lines: number }[] {
  return codeFiles(repo)
    .filter((f) => !isToolConfig(f.relPath))
    .map((f) => ({ relPath: f.relPath, lines: f.content.split("\n").length }));
}

/**
 * Tool configuration written in JS/TS - `.dependency-cruiser.js`, `eslint.config.js`,
 * `webpack.config.ts`, `.eslintrc.cjs`. Long because a tool has many options, not because
 * several responsibilities share a file, so it is not a god-file (domain-driven-hexagon's
 * 537-line `.dependency-cruiser.js`, held-out batch 2).
 */
export function isToolConfig(relPath: string): boolean {
  const base = relPath.split("/").pop() ?? relPath;
  return /^\.[\w.-]+\.(c|m)?[jt]s$/.test(base) || /\.config\.(c|m)?[jt]s$/.test(base) || /rc\.(c|m)?[jt]s$/.test(base);
}
