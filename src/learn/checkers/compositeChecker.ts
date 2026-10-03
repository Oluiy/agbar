import type { Challenge, CheckResult, CheckType, Checker } from "../types.js";

/**
 * One course, several kinds of challenge, each graded by the checker that owns
 * that kind. The reading course mixes "find the bug" (tests, via nodeChecker)
 * with "predict the output" (predictionChecker) - neither checker changes, and
 * adding a third kind is one more entry in the map, not an edit to either.
 */
export function compositeChecker(byType: Partial<Record<CheckType, Checker>>): Checker {
  function pick(challenge: Challenge): Checker {
    const checker = byType[challenge.checkType];
    if (!checker) {
      throw new Error(
        `No checker for check_type '${challenge.checkType}' in this course (challenge '${challenge.id}'). Supported: ${Object.keys(byType).join(", ")}.`
      );
    }
    return checker;
  }

  return {
    solutionPath: (workspaceDir, challenge) => pick(challenge).solutionPath(workspaceDir, challenge),
    scaffold: (challenge, workspaceDir) => pick(challenge).scaffold(challenge, workspaceDir),
    run: (challenge, workspaceDir): Promise<CheckResult> => pick(challenge).run(challenge, workspaceDir),
  };
}
