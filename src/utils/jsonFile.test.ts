import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readJsonFile } from "./jsonFile.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "buildquick-json-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("readJsonFile", () => {
  it("a missing or empty file is the fallback, not an error", () => {
    expect(readJsonFile(path.join(dir, "nope.json"), { a: 1 }, "x")).toEqual({ a: 1 });
    writeFileSync(path.join(dir, "empty.json"), "  \n");
    expect(readJsonFile(path.join(dir, "empty.json"), {}, "x")).toEqual({});
  });

  it("a corrupted file names itself and says how to recover, instead of a raw SyntaxError", () => {
    const file = path.join(dir, "progress.json");
    writeFileSync(file, "{broken");
    expect(() => readJsonFile(file, {}, "lesson progress")).toThrow(
      new RegExp(`${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} is corrupted.*lesson progress.*delete it`)
    );
  });
});
