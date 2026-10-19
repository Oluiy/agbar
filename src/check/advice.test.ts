import { describe, expect, it } from "vitest";
import { RULES } from "./rules.js";
import { STACK_ADVICE, type Language } from "./stackAdvice.js";

/**
 * Pins every piece of fix advice the tool gives - the "Next:" line a reader actually acts on.
 *
 * Finding precision has the corpus; generated projects have scaffold-verify.yml. The advice
 * had neither gate: it could be reworded to name a package that does not exist, or an API
 * that was renamed two majors ago, and every test here would still pass. The corpus cannot
 * catch it either - a baseline line carries the rule and the location, never the advice.
 *
 * So this snapshot makes any change to advice show up as a reviewable diff. Note what it
 * does NOT do: it cannot tell whether the advice is CORRECT, only that nobody changed it
 * unnoticed. Proving `tower-governor` exists and still has that API means asking the
 * registry, which needs the network and belongs in scheduled CI, not in `npm test`.
 */
function adviceTable(): string {
  const lines: string[] = [];
  for (const rule of [...RULES].sort((a, b) => a.id.localeCompare(b.id))) {
    lines.push(rule.id);
    lines.push(`  default   ${rule.nextStep}`);
    const perLanguage = STACK_ADVICE[rule.id];
    if (!perLanguage) continue;
    for (const language of (Object.keys(perLanguage) as Language[]).sort()) {
      lines.push(`  ${language.padEnd(9)} ${perLanguage[language]}`);
    }
  }
  return lines.join("\n");
}

describe("the fix advice every finding ends on", () => {
  it("is exactly what was last reviewed - change it and this diff is the review", () => {
    expect(adviceTable()).toMatchSnapshot();
  });

  it("never ships empty or placeholder advice, which would waste the one line a reader reads", () => {
    for (const rule of RULES) {
      expect(rule.nextStep.trim().length, `${rule.id} has no next step`).toBeGreaterThan(10);
      expect(rule.nextStep, `${rule.id} still has a placeholder`).not.toMatch(/TODO|FIXME|TBD|XXX/i);
    }
    for (const [ruleId, perLanguage] of Object.entries(STACK_ADVICE)) {
      for (const [language, advice] of Object.entries(perLanguage)) {
        expect(advice.trim().length, `${ruleId}/${language} has no advice`).toBeGreaterThan(10);
        expect(advice, `${ruleId}/${language} still has a placeholder`).not.toMatch(/TODO|FIXME|TBD|XXX/i);
      }
    }
  });
});
