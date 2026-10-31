import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadUnits } from "../loader.js";
import type { Challenge } from "../types.js";
import { nodeChecker } from "./nodeChecker.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "agbar-nodechecker-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function challenge(overrides: Partial<Challenge> = {}): Challenge {
  return {
    id: "c1",
    prompt: "",
    starterCode: "export const answer = 0;\n",
    checkType: "test_passes",
    gradedTests: `
import test from "node:test";
import assert from "node:assert/strict";
import { answer } from "./solution.js";
test("answer is 42", () => assert.equal(answer, 42));
`,
    ...overrides,
  };
}

describe("nodeChecker.scaffold", () => {
  it("writes a runnable workspace with no dependencies to install", () => {
    nodeChecker.scaffold(challenge(), tmpDir);
    expect(existsSync(path.join(tmpDir, "package.json"))).toBe(true);
    expect(existsSync(path.join(tmpDir, "solution.js"))).toBe(true);
    expect(existsSync(path.join(tmpDir, "solution.test.js"))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(tmpDir, "package.json"), "utf-8")).dependencies).toBeUndefined();
  });

  it("preserves an in-progress solution across re-scaffolds", () => {
    nodeChecker.scaffold(challenge(), tmpDir);
    writeFileSync(path.join(tmpDir, "solution.js"), "export const answer = 42;\n", "utf-8");
    nodeChecker.scaffold(challenge(), tmpDir);
    expect(readFileSync(path.join(tmpDir, "solution.js"), "utf-8")).toContain("42");
  });

  it("always rewrites hidden tests, so editing them to pass doesn't stick", () => {
    nodeChecker.scaffold(challenge(), tmpDir);
    writeFileSync(path.join(tmpDir, "solution.test.js"), "// deleted the tests\n", "utf-8");
    nodeChecker.scaffold(challenge(), tmpDir);
    expect(readFileSync(path.join(tmpDir, "solution.test.js"), "utf-8")).toContain("answer is 42");
  });
});

describe("nodeChecker.run", () => {
  it("fails the starter code and passes a correct solution", async () => {
    nodeChecker.scaffold(challenge(), tmpDir);
    const before = await nodeChecker.run(challenge(), tmpDir);
    expect(before.passed).toBe(false);

    writeFileSync(path.join(tmpDir, "solution.js"), "export const answer = 42;\n", "utf-8");
    const after = await nodeChecker.run(challenge(), tmpDir);
    expect(after.passed).toBe(true);
  }, 30000);

  it("surfaces the failing test name rather than raw TAP", async () => {
    nodeChecker.scaffold(challenge(), tmpDir);
    const result = await nodeChecker.run(challenge(), tmpDir);
    expect(result.message).toContain("answer is 42");
  }, 30000);

  // Regression: TAP renders multi-line assertion messages as a YAML block scalar,
  // and the summary used to print the literal "|-" instead of the message.
  it("extracts a multi-line assertion message, never the YAML block marker", async () => {
    const c = challenge({
      gradedTests: `
import test from "node:test";
import assert from "node:assert/strict";
import { answer } from "./solution.js";
test("checks the answer", () => assert.equal(answer, 42, "the answer must be exactly forty-two"));
`,
    });
    nodeChecker.scaffold(c, tmpDir);
    const result = await nodeChecker.run(c, tmpDir);
    expect(result.message).toContain("the answer must be exactly forty-two");
    expect(result.message).not.toContain("|-");
  }, 30000);

  it("rejects a check type it can't grade", async () => {
    const result = await nodeChecker.run(challenge({ checkType: "compiles_only" }), tmpDir);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("test_passes");
  });
});

describe.each(["algorithms", "refactoring"])("the bundled %s units", (language) => {
  it("all load, and every challenge ships hidden tests", () => {
    const units = loadUnits(language);
    expect(units.length).toBeGreaterThanOrEqual(2);
    for (const unit of units) {
      for (const c of unit.challenges) {
        expect(c.checkType).toBe("test_passes");
        expect(c.gradedTests, `${unit.id}/${c.id} has no graded tests`).toBeTruthy();
      }
    }
  });

  // The starter code must fail: a challenge that passes unmodified teaches nothing.
  it("every starter solution fails its own tests before being solved", async () => {
    for (const unit of loadUnits(language)) {
      for (const c of unit.challenges) {
        const dir = mkdtempSync(path.join(tmpdir(), "bq-starter-"));
        try {
          nodeChecker.scaffold(c, dir);
          const result = await nodeChecker.run(c, dir);
          expect(result.passed, `${unit.id}/${c.id} passes without being solved`).toBe(false);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }
    }
  }, 60000);
});
