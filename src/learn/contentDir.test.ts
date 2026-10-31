import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundledContentRoot, contentRoots, resolveContentPath } from "./contentDir.js";
import { loadUnits } from "./loader.js";

let tmpDir: string;
const originalEnv = process.env.AGBAR_CONTENT;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "agbar-content-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  if (originalEnv === undefined) delete process.env.AGBAR_CONTENT;
  else process.env.AGBAR_CONTENT = originalEnv;
});

describe("content roots", () => {
  it("finds the bundled content directory", () => {
    expect(bundledContentRoot()).toBeDefined();
  });

  it("puts a AGBAR_CONTENT directory ahead of the bundled one", () => {
    process.env.AGBAR_CONTENT = tmpDir;
    const roots = contentRoots();
    expect(roots[0]).toBe(tmpDir);
    expect(roots).toHaveLength(2);
  });

  it("falls through to bundled content for anything the custom root doesn't provide", () => {
    process.env.AGBAR_CONTENT = tmpDir; // empty - provides nothing
    expect(resolveContentPath("tracks.yaml")).toContain("content");
    expect(loadUnits("rust").length).toBeGreaterThan(0);
  });

  it("lets a custom root add a language the bundled content doesn't have", () => {
    const unitsDir = path.join(tmpDir, "go", "units");
    mkdirSync(unitsDir, { recursive: true });
    writeFileSync(
      path.join(unitsDir, "01-a.yaml"),
      `
id: "01-a"
chapter_ref: 1
title: "Custom"
prerequisites: []
core: false
estimated_minutes: 5
explanation: "Team standard."
example_code: "package main"
challenges:
  - id: "c1"
    prompt: "Do it."
    starter_code: "package main"
    check_type: "compiles_only"
`,
      "utf-8"
    );

    process.env.AGBAR_CONTENT = tmpDir;
    const units = loadUnits("go");
    expect(units).toHaveLength(1);
    expect(units[0].title).toBe("Custom");
  });

  it("lets a custom root override a bundled language's units entirely", () => {
    const unitsDir = path.join(tmpDir, "rust", "units");
    mkdirSync(unitsDir, { recursive: true });
    writeFileSync(
      path.join(unitsDir, "only.yaml"),
      `
id: "team-rust"
chapter_ref: 1
title: "Our Rust rules"
prerequisites: []
core: true
estimated_minutes: 5
explanation: "Internal."
example_code: "fn main() {}"
challenges:
  - id: "c1"
    prompt: "Do it."
    starter_code: "fn main() {}"
    check_type: "compiles_only"
`,
      "utf-8"
    );

    process.env.AGBAR_CONTENT = tmpDir;
    const units = loadUnits("rust");
    expect(units.map((u) => u.id)).toEqual(["team-rust"]);
  });
});
