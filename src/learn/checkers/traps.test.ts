import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadUnits } from "../loader.js";
import { nodeChecker } from "./nodeChecker.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "buildquick-traps-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const challenges = loadUnits("traps").flatMap((u) => u.challenges);

/** One correct fix per "fix the trap" challenge. */
const FIXES: Record<string, string> = {
  "fix-same-username": `const clean = (s) => s.normalize("NFC").replace(/[\\u200b-\\u200d\\ufeff]/g, "").trim().toLowerCase();
export function sameUsername(a, b) { return clean(a) === clean(b); }\n`,
  "fix-money-sum": `function toCents(s) {
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}
export function addMoney(amounts) {
  const cents = amounts.reduce((sum, a) => sum + toCents(a), 0);
  return \`\${Math.floor(cents / 100)}.\${String(cents % 100).padStart(2, "0")}\`;
}\n`,
  "fix-next-day": "export function nextDaySameTime(date) {\n  const next = new Date(date);\n  next.setDate(next.getDate() + 1);\n  return next;\n}\n",
  "fix-upload-path": `import path from "node:path";
export function uploadPath(dir, filename) {
  const name = path.basename(filename.replace(/\\\\/g, "/"));
  if (name === "" || name === "." || name === "..") throw new Error("invalid file name");
  return path.join(dir, name);
}\n`,
};

describe("traps course content stays true", () => {
  for (const c of challenges.filter((x) => x.checkType === "predict_output")) {
    // Every quirk the course claims is checked against a real run - a teaching
    // mistake here would teach the mistake.
    it(`${c.id}: the expected output is what the program really prints`, () => {
      const program = path.join(dir, "program.js");
      writeFileSync(program, c.starterCode);
      expect(execFileSync(process.execPath, [program], { encoding: "utf-8" }).trim()).toBe(c.expectedOutput!.trim());
    });
  }

  const bugs = challenges.filter((c) => c.checkType === "test_passes");
  it("every 'fix the trap' challenge has a reference fix here", () => {
    expect(bugs.map((c) => c.id).sort()).toEqual(Object.keys(FIXES).sort());
  });

  for (const c of bugs) {
    it(`${c.id}: the trap-laden starter fails, and a real fix passes`, async () => {
      nodeChecker.scaffold(c, dir);
      expect((await nodeChecker.run(c, dir)).passed).toBe(false);
      writeFileSync(nodeChecker.solutionPath(dir, c), FIXES[c.id]);
      const result = await nodeChecker.run(c, dir);
      expect(result.passed, result.message).toBe(true);
    });
  }
});
