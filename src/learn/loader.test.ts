import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadUnits } from "./loader.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "buildquick-learn-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeUnit(filename: string, contents: string): void {
  writeFileSync(path.join(tmpDir, filename), contents, "utf-8");
}

const VALID_UNIT = `
id: "01-a"
chapter_ref: 1
title: "A"
prerequisites: []
core: false
estimated_minutes: 10
explanation: "Explanation."
example_code: "fn main() {}"
challenges:
  - id: "c1"
    prompt: "Do it."
    starter_code: "fn main() {}"
    check_type: "compiles_only"
`;

describe("loadUnits", () => {
  it("parses a valid unit", () => {
    writeUnit("01-a.yaml", VALID_UNIT);
    const units = loadUnits("rust", tmpDir);
    expect(units).toHaveLength(1);
    expect(units[0].id).toBe("01-a");
    expect(units[0].challenges[0].checkType).toBe("compiles_only");
  });

  it("sorts units by chapter_ref", () => {
    writeUnit("b.yaml", VALID_UNIT.replace('id: "01-a"', 'id: "02-b"').replace("chapter_ref: 1", "chapter_ref: 2"));
    writeUnit("a.yaml", VALID_UNIT);
    const units = loadUnits("rust", tmpDir);
    expect(units.map((u) => u.id)).toEqual(["01-a", "02-b"]);
  });

  it("throws naming the file and field for a missing required field", () => {
    writeUnit("bad.yaml", VALID_UNIT.replace('title: "A"', ""));
    expect(() => loadUnits("rust", tmpDir)).toThrow(/bad\.yaml.*missing required field 'title'/);
  });

  it("refuses a predict_output challenge whose output has a '#' line - answer.txt treats those as comments", () => {
    writeUnit("bad.yaml", VALID_UNIT.replace('check_type: "compiles_only"', 'check_type: "predict_output"\n    expected_output: "# heading\\nok"'));
    expect(() => loadUnits("rust", tmpDir)).toThrow(/line starting with '#'/);
  });

  it("throws for an invalid check_type", () => {
    writeUnit("bad.yaml", VALID_UNIT.replace('check_type: "compiles_only"', 'check_type: "not_a_real_type"'));
    expect(() => loadUnits("rust", tmpDir)).toThrow(/invalid check_type/);
  });

  it("throws when a prerequisite references a unit that doesn't exist", () => {
    writeUnit("01-a.yaml", VALID_UNIT.replace("prerequisites: []", 'prerequisites: ["nonexistent"]'));
    expect(() => loadUnits("rust", tmpDir)).toThrow(/prerequisite 'nonexistent' doesn't match/);
  });

  it("throws when no unit files exist", () => {
    expect(() => loadUnits("rust", tmpDir)).toThrow(/No lesson units found/);
  });
});
