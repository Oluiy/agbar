import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadUnits } from "../loader.js";
import type { Challenge } from "../types.js";
import { nodeChecker } from "./nodeChecker.js";
import { predictionChecker } from "./predictionChecker.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "buildquick-reading-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const challenges = loadUnits("reading").flatMap((u) => u.challenges);
const predictions = challenges.filter((c) => c.checkType === "predict_output");
const bugs = challenges.filter((c) => c.checkType === "test_passes");

/** One correct fix per "find the bug" challenge. */
const FIXES: Record<string, string> = {
  "fix-foreach-await": `export async function totalPrice(ids, getPrice) {
  const prices = await Promise.all(ids.map((id) => getPrice(id)));
  return prices.reduce((sum, p) => sum + p, 0);
}\n`,
  "fix-sort-mutates": "export function topThree(scores) {\n  return [...scores].sort((a, b) => b - a).slice(0, 3);\n}\n",
  "fix-pagination":
    "export function getPage(items, page, pageSize) {\n  const start = (page - 1) * pageSize;\n  return items.slice(start, start + pageSize);\n}\n",
};

describe("reading content stays true", () => {
  for (const c of predictions) {
    // The answer key is checked against reality, so it can never drift from what the code does.
    it(`${c.id}: the expected output is what the program really prints`, () => {
      const program = path.join(dir, "program.js");
      writeFileSync(program, c.starterCode);
      const actual = execFileSync(process.execPath, [program], { encoding: "utf-8" });
      expect(actual.trim()).toBe(c.expectedOutput!.trim());
    });
  }

  it("every 'find the bug' challenge has a reference fix here", () => {
    expect(bugs.map((c) => c.id).sort()).toEqual(Object.keys(FIXES).sort());
  });

  for (const c of bugs) {
    it(`${c.id}: the AI-written starter fails, and a real fix passes`, async () => {
      nodeChecker.scaffold(c, dir);
      expect((await nodeChecker.run(c, dir)).passed).toBe(false);
      writeFileSync(nodeChecker.solutionPath(dir, c), FIXES[c.id]);
      const result = await nodeChecker.run(c, dir);
      expect(result.passed, result.message).toBe(true);
    });
  }
});

describe("predictionChecker", () => {
  const c = predictions[0] as Challenge;
  const answer = (text: string) => writeFileSync(predictionChecker.solutionPath(dir, c), text);

  it("scaffolds the program to read and an answer file with instructions", () => {
    predictionChecker.scaffold(c, dir);
    expect(execFileSync("cat", [path.join(dir, "program.js")], { encoding: "utf-8" })).toBe(c.starterCode);
  });

  it("passes an exact prediction, ignoring # lines and trailing spaces", async () => {
    answer(
      `# my answer\n${c
        .expectedOutput!.split("\n")
        .map((l) => `${l}  `)
        .join("\n")}`
    );
    expect((await predictionChecker.run(c, dir)).passed).toBe(true);
  });

  it("names the first wrong line without revealing the answer", async () => {
    const lines = c.expectedOutput!.trim().split("\n");
    lines[1] = "something else";
    answer(lines.join("\n"));
    const result = await predictionChecker.run(c, dir);
    expect(result.passed).toBe(false);
    expect(result.message).toMatch(/Line 2 is wrong/);
    expect(result.message).not.toContain(c.expectedOutput!.trim().split("\n")[1]);
  });

  it("an empty answer is reported as empty", async () => {
    answer("# nothing yet\n");
    expect((await predictionChecker.run(c, dir)).message).toMatch(/empty/);
  });
});
