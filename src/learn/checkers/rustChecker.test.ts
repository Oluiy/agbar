import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Challenge } from "../types.js";
import { rustChecker } from "./rustChecker.js";

function hasCargo(): boolean {
  try {
    execSync("cargo --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Honest about the dependency: these only run in an environment with a real
// Rust toolchain on PATH, and are skipped (not failed) otherwise.
const CARGO_AVAILABLE = hasCargo();

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "buildquick-rustchecker-test-"));
  mkdirSync(path.join(tmpDir, "src"), { recursive: true });
  writeFileSync(path.join(tmpDir, "Cargo.toml"), `[package]\nname = "checker_test"\nversion = "0.1.0"\nedition = "2021"\n`, "utf-8");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function challenge(overrides: Partial<Challenge>): Challenge {
  return { id: "c", prompt: "", starterCode: "", checkType: "compiles_only", ...overrides };
}

describe.skipIf(!CARGO_AVAILABLE)("rustChecker (requires cargo on PATH)", () => {
  it("fails compiles_only on code that doesn't compile", async () => {
    writeFileSync(path.join(tmpDir, "src", "main.rs"), 'fn main() { let x: i32 = "nope"; }', "utf-8");
    const result = await rustChecker.run(challenge({ checkType: "compiles_only" }), tmpDir);
    expect(result.passed).toBe(false);
  }, 20000);

  it("passes compiles_only on code that compiles", async () => {
    writeFileSync(path.join(tmpDir, "src", "main.rs"), "fn main() { let _x = 5; }", "utf-8");
    const result = await rustChecker.run(challenge({ checkType: "compiles_only" }), tmpDir);
    expect(result.passed).toBe(true);
  }, 20000);

  it("compares trimmed stdout for compiles_and_output_matches", async () => {
    writeFileSync(path.join(tmpDir, "src", "main.rs"), 'fn main() { println!("hi"); }', "utf-8");
    const result = await rustChecker.run(challenge({ checkType: "compiles_and_output_matches", expectedOutput: "hi" }), tmpDir);
    expect(result.passed).toBe(true);
  }, 20000);

  it("fails compiles_and_output_matches when output doesn't match", async () => {
    writeFileSync(path.join(tmpDir, "src", "main.rs"), 'fn main() { println!("wrong"); }', "utf-8");
    const result = await rustChecker.run(challenge({ checkType: "compiles_and_output_matches", expectedOutput: "hi" }), tmpDir);
    expect(result.passed).toBe(false);
  }, 20000);
});
