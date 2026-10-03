import pc from "picocolors";
import { name } from "../../ui/palette.js";
import { findPitfalls, type Pitfall } from "./pitfalls.js";
import { parsePattern, RegexTimeout, REGEX_TIMEOUT_MS, safeMatchAll } from "./safeRegex.js";

/**
 * `buildquick regex "<pattern>" [text...]` - see exactly what a pattern matches.
 * Matches are highlighted inside each text (the part people misjudge is WHERE
 * it matched, not whether), groups are listed, and the classic pitfalls are
 * called out before they become bugs. Runs with a timeout, so a catastrophic
 * pattern is reported, not frozen on.
 */

const MARK: Record<Pitfall["severity"], (s: string) => string> = {
  danger: (s) => pc.bold(pc.red(`✖ ${s}`)),
  warning: (s) => pc.yellow(`▲ ${s}`),
  note: (s) => pc.dim(`• ${s}`),
};

function highlight(text: string, matches: { index: number; text: string }[]): string {
  let out = "";
  let at = 0;
  for (const m of matches) {
    out += text.slice(at, m.index);
    // An empty match has nothing to paint; show where it happened.
    out += m.text === "" ? pc.magenta("|") : pc.bold(pc.bgYellow(pc.black(m.text)));
    at = m.index + m.text.length;
  }
  return out + text.slice(at);
}

export function printRegexReport(pattern: string, texts: string[], flags = ""): void {
  let re: RegExp;
  try {
    re = parsePattern(pattern, flags);
  } catch (err) {
    console.error(pc.red(`That pattern doesn't compile: ${(err as Error).message}`));
    process.exitCode = 1;
    return;
  }

  console.log(`\n${pc.bold("Pattern")} ${name(`/${re.source}/${re.flags}`)}\n`);

  for (const text of texts) {
    try {
      const matches = safeMatchAll(re, text);
      if (matches.length === 0) {
        console.log(`  ${pc.red("✗")} ${JSON.stringify(text)}  ${pc.dim("no match")}`);
        continue;
      }
      const whole = matches.length === 1 && matches[0].index === 0 && matches[0].text.length === text.length;
      const label = whole ? pc.green("whole text matched") : pc.yellow(`matched ${matches.length === 1 ? "part of it" : `${matches.length} places`}`);
      console.log(`  ${pc.green("✓")} ${highlight(text, matches)}  ${label}`);
      const withGroups = matches.find((m) => m.groups.length > 0);
      if (withGroups) {
        withGroups.groups.forEach((g, i) => console.log(`      ${pc.dim(`$${i + 1}`)} ${g === undefined ? pc.dim("(not set)") : name(JSON.stringify(g))}`));
      }
    } catch (err) {
      if (!(err instanceof RegexTimeout)) throw err;
      console.log(`  ${pc.bold(pc.red("✖"))} ${JSON.stringify(text)}  ${pc.bold(pc.red(`gave up after ${REGEX_TIMEOUT_MS}ms - catastrophic backtracking`))}`);
    }
  }
  if (texts.length === 0) console.log(pc.dim("  Pass some text after the pattern to see what it matches, e.g. buildquick regex '^\\d{5}$' 12345 123456"));

  const pitfalls = findPitfalls(re.source, re.flags);
  if (pitfalls.length > 0) {
    console.log(`\n${pc.bold("Worth checking:")}`);
    for (const p of pitfalls) console.log(`  ${MARK[p.severity](p.message)}`);
  }
  console.log(pc.dim("\nLearn the why: buildquick learn regex"));
}
