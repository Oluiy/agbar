import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { writeFile } from "../../utils/fsWrite.js";
import type { Challenge, CheckResult, Checker } from "../types.js";

const TIMEOUT_MS = 20_000;

/**
 * Grades JavaScript challenges with `node --test`, Node's built-in test runner.
 *
 * Chosen over vitest/jest deliberately: the scratch workspace needs **zero
 * dependencies** and zero `npm install`, so a challenge runs instantly, offline,
 * on any machine that can already run buildquick. Adding a test framework would
 * mean a package install per challenge, which is a worse experience for what is
 * meant to be a two-minute exercise.
 */

function packageJson(name: string): string {
  return `${JSON.stringify({ name, version: "1.0.0", private: true, type: "module" }, null, 2)}\n`;
}

export const nodeChecker: Checker = {
  solutionPath(workspaceDir: string): string {
    return path.join(workspaceDir, "solution.js");
  },

  scaffold(challenge: Challenge, workspaceDir: string): void {
    const solution = this.solutionPath(workspaceDir, challenge);
    if (!existsSync(solution)) {
      writeFile(solution, challenge.starterCode);
    }
    writeFile(path.join(workspaceDir, "package.json"), packageJson(`learn-${challenge.id}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase()));

    // Always rewritten, never preserved: the tests live in the learner's own
    // directory, so if they were left alone, editing them to pass would be the
    // path of least resistance. Reading them is fine, and useful when a run fails -
    // only editing them is the shortcut worth closing.
    if (challenge.gradedTests) {
      writeFile(path.join(workspaceDir, "solution.test.js"), challenge.gradedTests);
    }
  },

  async run(challenge: Challenge, workspaceDir: string): Promise<CheckResult> {
    if (challenge.checkType !== "test_passes") {
      return { passed: false, message: `The JavaScript checker only supports check_type 'test_passes', not '${challenge.checkType}'.` };
    }
    if (!challenge.gradedTests) {
      return { passed: false, message: `Challenge '${challenge.id}' is check_type 'test_passes' but defines no graded_tests.` };
    }

    return new Promise<CheckResult>((resolve) => {
      const child = spawn(process.execPath, ["--test"], { cwd: workspaceDir, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, TIMEOUT_MS);

      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({ passed: false, message: `Couldn't run node --test: ${err.message}` });
      });

      child.on("exit", (code) => {
        clearTimeout(timer);
        if (timedOut) {
          resolve({
            passed: false,
            message: `Timed out after ${TIMEOUT_MS / 1000}s - an infinite loop, or waiting on something that never resolves.`,
          });
          return;
        }
        if (code === 0) {
          resolve({ passed: true, message: "All tests passed." });
          return;
        }
        resolve({ passed: false, message: summarizeFailures(stdout, stderr) });
      });
    });
  },
};

/**
 * node --test emits TAP. Surfacing the whole thing buries the useful part, so pull
 * out the failing test names and the first error message instead.
 */
function summarizeFailures(stdout: string, stderr: string): string {
  const lines = stdout.split("\n");
  const failed = lines.filter((l) => /^not ok \d+/.test(l.trim())).map((l) => l.trim().replace(/^not ok \d+\s*-?\s*/, ""));

  const parts: string[] = [];
  if (failed.length > 0) parts.push(`Failing: ${failed.join(", ")}`);

  const message = firstErrorMessage(lines);
  if (message) parts.push(message);
  if (parts.length === 0) parts.push(stderr.trim() || stdout.trim() || "Tests failed.");

  return parts.join("\n");
}

/**
 * The assertion message is the single most useful line for a learner, and TAP
 * hides it two different ways: inline (`error: 'expected x'`) or as a YAML block
 * scalar (`error: |-` followed by indented lines). Handle both - printing the
 * literal "|-" helps nobody.
 */
function firstErrorMessage(lines: string[]): string | undefined {
  const index = lines.findIndex((l) => /^\s*error:/i.test(l));
  if (index === -1) return undefined;

  const inline = lines[index].replace(/^\s*error:\s*/i, "").trim();
  if (inline && inline !== "|-" && inline !== "|") {
    return inline.replace(/^['"]|['"]$/g, "");
  }

  const indent = (lines[index].match(/^\s*/) ?? [""])[0].length;
  const block: string[] = [];
  for (let i = index + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") break;
    const lineIndent = (line.match(/^\s*/) ?? [""])[0].length;
    if (lineIndent <= indent) break; // dedented back out of the block
    block.push(line.trim());
  }
  return block.length > 0 ? block.join(" ") : undefined;
}
