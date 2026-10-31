import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { regexChecker } from "../checkers/regexChecker.js";
import { loadUnits } from "../loader.js";
import { findPitfalls } from "./pitfalls.js";
import { parsePattern, RegexTimeout, safeExec } from "./safeRegex.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "agbar-regex-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const challenges = loadUnits("regex").flatMap((u) => u.challenges);
const patternChallenges = challenges.filter((c) => c.checkType === "regex_cases");

/** One correct pattern per regex challenge. */
const SOLUTIONS: Record<string, string> = {
  "zip-code": "^\\d{5}$",
  "csv-file": "\\.csv$",
  "first-tag": "<([^>]+)>",
  "pet-word": "^(?:cat|dog)$",
  "fix-catastrophic": "^a+$",
};

async function grade(id: string, pattern: string) {
  const c = patternChallenges.find((x) => x.id === id)!;
  writeFileSync(regexChecker.solutionPath(dir, c), `# my answer\n${pattern}\n`);
  return regexChecker.run(c, dir);
}

describe("regex course content", () => {
  it("every pattern challenge has a reference solution here", () => {
    expect(patternChallenges.map((c) => c.id).sort()).toEqual(Object.keys(SOLUTIONS).sort());
  });

  for (const c of patternChallenges) {
    it(`${c.id}: the starter pattern fails and a correct one passes`, async () => {
      expect((await grade(c.id, c.starterCode.trim())).passed).toBe(false);
      const result = await grade(c.id, SOLUTIONS[c.id]);
      expect(result.passed, result.message).toBe(true);
    });
  }

  for (const c of challenges.filter((x) => x.checkType === "predict_output")) {
    it(`${c.id}: the expected output is what the program really prints`, () => {
      const program = path.join(dir, "program.js");
      writeFileSync(program, c.starterCode);
      expect(execFileSync(process.execPath, [program], { encoding: "utf-8" }).trim()).toBe(c.expectedOutput!.trim());
    });
  }
});

describe("regexChecker feedback", () => {
  it("shows WHAT matched inside an input it should have rejected - that's the lesson", async () => {
    const result = await grade("zip-code", "\\d{5}");
    expect(result.message).toMatch(/should reject "123456", but matched "12345" inside it/);
    expect(result.message).toMatch(/✓ matches "12345"/);
  });

  it("reports catastrophic backtracking as a failed case instead of hanging", async () => {
    const started = Date.now();
    const result = await grade("fix-catastrophic", "^(a+)+$");
    expect(result.message).toMatch(/catastrophic backtracking/);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("explains a pattern that doesn't compile, and an empty answer", async () => {
    expect((await grade("zip-code", "^(\\d{5}$")).message).toMatch(/doesn't compile/);
    expect((await grade("zip-code", "")).message).toMatch(/no pattern yet/);
  });

  it("keeps a pattern that starts with # (a hex colour), only '# ' lines are comments", async () => {
    const c = patternChallenges[0];
    writeFileSync(regexChecker.solutionPath(dir, c), "#[0-9a-f]{5}\n");
    expect((await regexChecker.run(c, dir)).message).not.toMatch(/no pattern yet/);
  });
});

describe("safeRegex", () => {
  it("accepts /pattern/flags or a bare pattern", () => {
    expect(parsePattern("/abc/i").flags).toBe("i");
    expect(parsePattern("a\\d").source).toBe("a\\d");
  });

  it("interrupts catastrophic backtracking with RegexTimeout", () => {
    expect(() => safeExec(/^(a+)+$/, `${"a".repeat(32)}!`)).toThrow(RegexTimeout);
  });

  it("ignores a g flag's lastIndex - the same input always gives the same answer", () => {
    const re = /^\d+$/g;
    expect(safeExec(re, "42")).not.toBeNull();
    expect(safeExec(re, "42")).not.toBeNull();
  });
});

describe("pitfalls", () => {
  const kinds = (src: string, flags = "") => findPitfalls(src, flags).map((p) => p.message);

  it("flags nested quantifiers as dangerous", () => {
    expect(findPitfalls("^(a+)+$", "").some((p) => p.severity === "danger")).toBe(true);
    expect(findPitfalls("^(\\w*)*$", "").some((p) => p.severity === "danger")).toBe(true);
  });

  it("flags alternation precedence and unescaped dots", () => {
    expect(kinds("^cat|dog$").join()).toMatch(/lowest precedence/);
    expect(kinds("^example.com$").join()).toMatch(/unescaped/);
  });

  it("a clean, anchored, escaped pattern raises nothing serious", () => {
    expect(findPitfalls("^\\d{5}$", "").filter((p) => p.severity !== "note")).toEqual([]);
    expect(findPitfalls("^example\\.com$", "").filter((p) => p.severity !== "note")).toEqual([]);
  });

  it("notes the g flag's statefulness", () => {
    expect(kinds("^\\d+$", "g").join()).toMatch(/lastIndex/);
  });
});
