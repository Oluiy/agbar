import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeFile } from "../../utils/fsWrite.js";
import type { Challenge, CheckResult, Checker } from "../types.js";

/**
 * "Predict what this prints": the learner reads program.js and writes the output
 * they expect into answer.txt - without running it. Grades reading: knowing what
 * code actually does, which matters most when someone or something else wrote it.
 *
 * The expected output is never shown on failure - only which line first differs.
 * Showing it would turn a reading exercise into a copying one. Content accuracy
 * is enforced by a test that runs every program and compares its real output.
 */

const INSTRUCTIONS = "# Write exactly what program.js prints, one line per line. Don't run it - read it.\n# Lines starting with # are ignored.\n";

function lines(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => !l.startsWith("#"))
    .map((l) => l.trimEnd())
    .join("\n")
    .trim()
    .split("\n");
}

export const predictionChecker: Checker = {
  solutionPath(workspaceDir: string): string {
    return path.join(workspaceDir, "answer.txt");
  },

  scaffold(challenge: Challenge, workspaceDir: string): void {
    // The program is rewritten every time (it's the question, not the answer);
    // the learner's answer is kept.
    writeFile(path.join(workspaceDir, "program.js"), challenge.starterCode);
    const answer = this.solutionPath(workspaceDir, challenge);
    if (!existsSync(answer)) writeFile(answer, INSTRUCTIONS);
  },

  async run(challenge: Challenge, workspaceDir: string): Promise<CheckResult> {
    if (challenge.checkType !== "predict_output" || challenge.expectedOutput === undefined) {
      return { passed: false, message: `The prediction checker needs check_type 'predict_output' with expected_output (challenge '${challenge.id}').` };
    }
    const predicted = lines(readFileSync(this.solutionPath(workspaceDir, challenge), "utf-8"));
    const expected = lines(challenge.expectedOutput);

    if (predicted.length === 1 && predicted[0] === "") return { passed: false, message: "answer.txt is empty - write what you think program.js prints." };
    const diff = expected.findIndex((line, i) => predicted[i] !== line);
    if (diff === -1 && predicted.length === expected.length) {
      return { passed: true, message: `Correct - all ${expected.length} line(s) predicted.` };
    }
    if (diff === -1) {
      return {
        passed: false,
        message: `The first ${expected.length} line(s) are right, but you predicted ${predicted.length} - it prints ${expected.length}.`,
      };
    }
    return {
      passed: false,
      message: `Line ${diff + 1} is wrong: you predicted '${predicted[diff] ?? "(nothing)"}'. Re-read the code around what produces that line.`,
    };
  },
};
