import { describe, expect, it } from "vitest";
import { SUPPORTED_LEARN_LANGUAGES } from "./learnCommand.js";
import { loadUnits } from "./loader.js";

/**
 * "Jargon is glossed in plain words where a learner first meets it" is a rule this project
 * keeps, and one that quietly rots: LRU was expanded three paragraphs below the title, and
 * LFU and ARC were never expanded at all. A learner who does not know the letters cannot
 * look them up from inside a terminal lesson.
 *
 * So an acronym must either be on the assumed-known list below, or be glossed somewhere in
 * its own lesson. The test cannot judge whether a gloss is GOOD - only that the plain words
 * appear near the letters at least once, which is the part that was missing.
 */

/**
 * Acronyms a backend learner already owns, so glossing them would read as condescension.
 * Adding to this list is a deliberate claim about the reader; prefer glossing instead.
 */
const ASSUMED_KNOWN = new Set([
  "API",
  "HTTP",
  "HTTPS",
  "JSON",
  "YAML",
  "CLI",
  "CPU",
  "URL",
  "SQL",
  "UTC",
  "UTF",
  "ID",
  "PR",
  "GET",
  "POST",
  "PUT",
  "AI",
  "NET",
  "OS",
  "IO",
  "TZ",
  "DST",
]);

/** Caps used for emphasis or as literal syntax (cron day/month tokens), not abbreviations. */
const NOT_AN_ACRONYM =
  /^(AND|OR|NOT|TWO|ONE|WHEN|WHAT|WHERE|HOW|WHY|ALL|NEW|OLD|YES|NO|SPACE|TAB|US|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|MON|TUE|WED|THU|FRI|SAT|SUN)$/;

/** The prose a learner reads. Code samples are excluded: identifiers are not jargon. */
function proseOf(unit: { keyIdea?: string; explanation: string; challenges: { prompt: string; hint?: string }[] }): string {
  return [unit.keyIdea ?? "", unit.explanation, ...unit.challenges.flatMap((c) => [c.prompt, c.hint ?? ""])].join("\n").replace(/`[^`]*`/g, " ");
}

/**
 * True when plain words sit immediately beside the letters, in either of the two styles the
 * lessons already use:
 *
 *   least recently used (LRU)      words, then the letters in brackets
 *   composed form, **NFC**         words, then the letters after a comma
 *
 * Deliberately NOT a check that the words spell out the acronym. "The clock-sync service
 * (NTP)" teaches a reader more than "Network Time Protocol (NTP)", which is just more
 * jargon; demanding the expansion would have pushed the content the wrong way.
 */
function isGlossed(acronym: string, prose: string): boolean {
  const bracketed = new RegExp(`[a-z]{3,}[^.()]{0,24}\\(\\*{0,2}${acronym}\\*{0,2}\\)`);
  const afterComma = new RegExp(`[a-z]{3,},\\s*\\*{0,2}${acronym}\\b`);
  return bracketed.test(prose) || afterComma.test(prose);
}

describe("acronyms in lesson prose", () => {
  it("are either assumed known or glossed in the lesson that uses them", () => {
    const ungloss: string[] = [];
    for (const language of SUPPORTED_LEARN_LANGUAGES) {
      for (const unit of loadUnits(language)) {
        const prose = proseOf(unit);
        const found = new Set(prose.match(/\b[A-Z]{2,5}\b/g) ?? []);
        for (const acronym of found) {
          if (ASSUMED_KNOWN.has(acronym) || NOT_AN_ACRONYM.test(acronym)) continue;
          if (!isGlossed(acronym, prose)) ungloss.push(`${language}/${unit.id}: '${acronym}' is never spelled out`);
        }
      }
    }
    expect(ungloss, `gloss these on first use, or add them to ASSUMED_KNOWN:\n${ungloss.join("\n")}`).toEqual([]);
  });
});
