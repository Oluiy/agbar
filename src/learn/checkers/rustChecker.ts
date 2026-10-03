import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { writeFile } from "../../utils/fsWrite.js";
import type { Challenge, CheckResult, Checker } from "../types.js";

const TIMEOUT_MS = 15_000;

function isCargoInstalled(): boolean {
  try {
    execSync("cargo --version", { encoding: "utf-8" });
    return true;
  } catch {
    return false;
  }
}

interface SpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Same spawn+Promise shape as stacks/aspnetcore/adapter.ts's generate(), but with piped (not inherited) stdio so output can be captured and compared, plus a bounded timeout instead of running forever. */
function runCargo(args: string[], cwd: string): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn("cargo", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

    child.on("error", () => {
      clearTimeout(timer);
      resolve({ exitCode: null, stdout, stderr: stderr || "Failed to start cargo.", timedOut });
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr, timedOut });
    });
  });
}

/**
 * check_type: "compiles_only" runs `cargo check`; "compiles_and_output_matches"
 * runs `cargo run` and compares trimmed stdout to the challenge's
 * expected_output. "test_passes"/"clippy_clean" aren't implemented yet - see
 * the plan.
 */
function cargoToml(packageName: string): string {
  return `[package]
name = "${packageName}"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "${packageName}"
path = "src/main.rs"
`;
}

export const rustChecker: Checker = {
  solutionPath(workspaceDir: string): string {
    return path.join(workspaceDir, "src", "main.rs");
  },

  scaffold(challenge: Challenge, workspaceDir: string): void {
    const mainRsPath = this.solutionPath(workspaceDir, challenge);
    if (existsSync(mainRsPath)) return; // preserve in-progress work

    // A leading digit or hyphen-heavy id isn't always a valid crate name, so use a
    // guaranteed-safe prefix rather than trying to sanitize every possible id shape.
    const packageName = `learn_${challenge.id}`.replace(/[^a-zA-Z0-9_]/g, "_");
    writeFile(path.join(workspaceDir, "Cargo.toml"), cargoToml(packageName));
    writeFile(mainRsPath, challenge.starterCode);
  },

  async run(challenge: Challenge, workspaceDir: string): Promise<CheckResult> {
    if (!isCargoInstalled()) {
      return { passed: false, message: "cargo isn't on PATH. Install Rust (https://rustup.rs) before running Rust challenges." };
    }

    if (challenge.checkType === "compiles_only") {
      const result = await runCargo(["check", "--quiet"], workspaceDir);
      if (result.timedOut) return { passed: false, message: `Timed out after ${TIMEOUT_MS / 1000}s.` };
      return result.exitCode === 0 ? { passed: true, message: "Compiles." } : { passed: false, message: result.stderr.trim() || "Failed to compile." };
    }

    if (challenge.checkType === "compiles_and_output_matches") {
      const result = await runCargo(["run", "--quiet"], workspaceDir);
      if (result.timedOut) return { passed: false, message: `Timed out after ${TIMEOUT_MS / 1000}s.` };
      if (result.exitCode !== 0) {
        return { passed: false, message: result.stderr.trim() || "Failed to compile or run." };
      }
      const actual = result.stdout.trim();
      const expected = (challenge.expectedOutput ?? "").trim();
      return actual === expected ? { passed: true, message: "Output matches." } : { passed: false, message: `Expected:\n${expected}\n\nGot:\n${actual}` };
    }

    if (challenge.checkType === "clippy_clean") {
      // -D warnings promotes every lint to an error, so "idiomatic" is a pass/fail
      // the toolchain decides rather than something this tool has to judge.
      const result = await runCargo(["clippy", "--quiet", "--", "-D", "warnings"], workspaceDir);
      if (result.timedOut) return { passed: false, message: `Timed out after ${TIMEOUT_MS / 1000}s.` };
      if (result.exitCode === 0) return { passed: true, message: "Clippy is happy." };
      const message = result.stderr.trim();
      return {
        passed: false,
        message: message.includes("no such command") ? "clippy isn't installed. Run 'rustup component add clippy' first." : message || "Clippy reported lints.",
      };
    }

    return { passed: false, message: `Unsupported check_type '${challenge.checkType}'.` };
  },
};
