/**
 * Language-agnostic core of `agbar learn` - same DIP shape as
 * src/stacks/StackAdapter.ts (a generic engine, per-language plugins), applied
 * to checking a learner's submission instead of generating a project. Nothing
 * in this file may import anything Rust-specific; that only happens inside a
 * Checker implementation (see checkers/rustChecker.ts).
 */

export type CheckType = "compiles_only" | "compiles_and_output_matches" | "clippy_clean" | "test_passes" | "yaml_assertions" | "predict_output" | "regex_cases";

/**
 * For check_type: "regex_cases". The learner's pattern is run against strings it
 * must match and strings it must reject - rejects are where most real regex bugs
 * live (a missing anchor matches "123456" as a zip code).
 */
export interface RegexCases {
  matches: string[];
  rejects: string[];
  /** For patterns that extract: the input, and the capture groups the first match must produce. */
  captures?: { input: string; groups: string[] }[];
}

/**
 * One graded fact about a learner's YAML file, for check_type: "yaml_assertions".
 * Declarative on purpose: config files are graded by what they *mean* once
 * parsed, not by how they're spelled, so any valid way of writing the answer
 * passes. Every check present on an assertion must hold.
 */
export interface YamlAssertion {
  /** Dot path into the parsed document, e.g. `jobs.test.steps[0].uses`. "" is the root. */
  path: string;
  /** Shown when the assertion fails - this is the teaching moment, so say why. */
  message: string;
  /** The key is present (even with an empty/null value, like `workflow_dispatch:`) - or absent, if false. */
  exists?: boolean;
  /** Deep equality with the parsed value. */
  equals?: unknown;
  /** The parsed type - catches `3.10` silently becoming the number 3.1. */
  type?: "string" | "number" | "boolean" | "list" | "map" | "null";
  /** Regex tested against String(value); lists join with ",", so "^test$" accepts `test` and `[test]`. */
  matches?: string;
  /** The value is a list with at least one item whose sub-paths match these regexes (order-independent). */
  hasItem?: Record<string, string>;
  /** The value is a cron expression that must fire at each of these UTC times (ISO 8601). */
  cronFires?: string[];
  /** The value is a cron expression that must NOT fire at any of these UTC times. */
  cronSkips?: string[];
}

export interface Challenge {
  id: string;
  prompt: string;
  starterCode: string;
  checkType: CheckType;
  expectedOutput?: string;
  hint?: string;
  /**
   * For check_type: "test_passes". The tests a submission is graded by.
   *
   * They are NOT hidden: the file lands in the learner's own workspace next to the
   * solution, and reading it is fine - the prompt already specifies the behaviour, so
   * the tests only restate it with concrete values. What they must not be is *edited*,
   * which is why they are rewritten from this YAML on every scaffold. Hiding them
   * instead would only make a failure harder to debug.
   *
   * The exception is predict_output, where seeing the answer IS the exercise; that
   * checker keeps its expected output to itself.
   */
  gradedTests?: string;
  /** For check_type: "yaml_assertions". Lives in the lesson YAML, never in the learner's workspace. */
  assertions?: YamlAssertion[];
  /** For check_type: "regex_cases". */
  regexCases?: RegexCases;
}

/**
 * A short recall question for `learn --review`. Answered from memory by typing,
 * not by picking from options - producing an answer strengthens memory more
 * than recognising one - then shown the answer and why, straight away.
 */
export interface ReviewQuestion {
  /** Stable within the unit: the schedule is keyed on it, so renaming resets progress. */
  id: string;
  question: string;
  answer: string;
  /** Other spellings that are equally right ("n+1", "n plus one"). */
  accept?: string[];
  /** Shown after answering, right or wrong - the feedback half of retrieval practice. */
  explain?: string;
}

export interface Unit {
  id: string;
  chapterRef: number;
  title: string;
  prerequisites: string[];
  core: boolean;
  estimatedMinutes: number;
  /**
   * One sentence: the thing to carry away if nothing else sticks.
   *
   * Optional, and deliberately so - it is a spine for skimming and a re-entry point when
   * you come back to a half-finished lesson, not a summary that excuses reading. Lessons
   * whose point genuinely needs a paragraph should leave it out rather than flatten it.
   */
  keyIdea?: string;
  explanation: string;
  exampleCode: string;
  challenges: Challenge[];
  /** Recall questions, scheduled individually once the unit is passed. */
  reviewQuestions: ReviewQuestion[];
  /** Parsed for schema forward-compatibility; no renderer exists yet. */
  diagram?: string;
  /** Parsed for schema forward-compatibility; no scaffolder cross-link exists yet. */
  projectTieIn?: { note: string };
}

export interface CheckResult {
  passed: boolean;
  message: string;
}

/**
 * One implementation per language. A checker owns its language's project shape as
 * well as how to grade it - workspace.ts used to hardcode Cargo.toml + src/main.rs,
 * which no JS or Maven project could ever fit.
 */
export interface Checker {
  /**
   * Create the scratch project for a challenge. Must preserve an existing solution
   * file (a learner's in-progress work survives re-running `learn`), but must
   * rewrite the graded tests every time (see Challenge.gradedTests).
   */
  scaffold(challenge: Challenge, workspaceDir: string): void;
  /**
   * The file the learner is meant to edit, for printing "Edit: ...". Takes the
   * challenge because one checker can grade several kinds: a "predict the output"
   * challenge is answered in answer.txt, a "find the bug" one in solution.js.
   */
  solutionPath(workspaceDir: string, challenge: Challenge): string;
  run(challenge: Challenge, workspaceDir: string): Promise<CheckResult>;
}
