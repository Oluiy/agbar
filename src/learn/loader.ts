import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { resolveContentPath } from "./contentDir.js";
import type { Challenge, CheckType, ReviewQuestion, Unit } from "./types.js";
import { parseAssertions } from "./yamlAssertions.js";
import { parseRegexCases } from "./checkers/regexChecker.js";

const VALID_CHECK_TYPES: CheckType[] = [
  "compiles_only",
  "compiles_and_output_matches",
  "clippy_clean",
  "test_passes",
  "yaml_assertions",
  "predict_output",
  "regex_cases",
];

function requireField(raw: Record<string, unknown>, field: string, where: string): unknown {
  const value = raw[field];
  if (value === undefined || value === null || value === "") {
    throw new Error(`${where}: missing required field '${field}'.`);
  }
  return value;
}

function parseChallenge(raw: Record<string, unknown>, file: string, index: number): Challenge {
  const where = `${file}: challenges[${index}]`;
  const id = requireField(raw, "id", where) as string;
  const prompt = requireField(raw, "prompt", where) as string;
  const starterCode = requireField(raw, "starter_code", where) as string;
  const checkType = requireField(raw, "check_type", where) as string;
  if (!VALID_CHECK_TYPES.includes(checkType as CheckType)) {
    throw new Error(`${where}: invalid check_type '${checkType}'. Use one of: ${VALID_CHECK_TYPES.join(", ")}.`);
  }

  // Checked before the "requires graded_tests" error below, which a stale lesson would
  // otherwise hit first - naming the rename is far more useful than naming the symptom.
  if (raw.hidden_tests !== undefined) {
    throw new Error(`${where}: 'hidden_tests' is now 'graded_tests' - the file is written into the learner's workspace, so it was never hidden.`);
  }
  const gradedTests = typeof raw.graded_tests === "string" ? raw.graded_tests : undefined;
  // A test_passes challenge with no tests would silently pass nothing - catch it
  // at load time rather than at submit time.
  if (checkType === "test_passes" && !gradedTests) {
    throw new Error(`${where}: check_type 'test_passes' requires 'graded_tests'.`);
  }
  if (checkType === "predict_output" && typeof raw.expected_output !== "string") {
    throw new Error(`${where}: check_type 'predict_output' requires 'expected_output' - the output the learner has to predict.`);
  }
  // Lines starting with # are comments in answer.txt, so a program printing one
  // could never be answered correctly - refuse it at load time, not at submit.
  if (checkType === "predict_output" && (raw.expected_output as string).split("\n").some((l) => l.startsWith("#"))) {
    throw new Error(
      `${where}: expected_output has a line starting with '#', which answer.txt treats as a comment - the learner could never match it. Change what the program prints.`
    );
  }

  return {
    id,
    prompt,
    starterCode,
    checkType: checkType as CheckType,
    expectedOutput: typeof raw.expected_output === "string" ? raw.expected_output : undefined,
    hint: typeof raw.hint === "string" ? raw.hint : undefined,
    gradedTests,
    assertions: checkType === "yaml_assertions" ? parseAssertions(raw.assertions, where) : undefined,
    regexCases: checkType === "regex_cases" ? parseRegexCases(raw.regex_cases, where) : undefined,
  };
}

/** Optional list; when present, every entry is validated like everything else here - loudly. */
function parseReviewQuestions(raw: unknown, file: string): ReviewQuestion[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error(`${file}: 'review_questions' must be a list.`);
  const seen = new Set<string>();
  return raw.map((entry, i) => {
    const where = `${file}: review_questions[${i}]`;
    const q = entry as Record<string, unknown>;
    const id = requireField(q, "id", where) as string;
    if (seen.has(id)) throw new Error(`${where}: duplicate id '${id}' - the review schedule is keyed on it.`);
    seen.add(id);
    return {
      id,
      question: requireField(q, "question", where) as string,
      answer: String(requireField(q, "answer", where)),
      accept: Array.isArray(q.accept) ? q.accept.map(String) : undefined,
      explain: typeof q.explain === "string" ? q.explain : undefined,
    };
  });
}

function parseUnit(raw: Record<string, unknown>, file: string): Unit {
  const id = requireField(raw, "id", file) as string;
  const chapterRef = requireField(raw, "chapter_ref", file) as number;
  const title = requireField(raw, "title", file) as string;
  const explanation = requireField(raw, "explanation", file) as string;
  const exampleCode = requireField(raw, "example_code", file) as string;

  const rawChallenges = raw.challenges;
  if (!Array.isArray(rawChallenges) || rawChallenges.length === 0) {
    throw new Error(`${file}: missing required field 'challenges' (must be a non-empty list).`);
  }

  const projectTieIn = raw.project_tiein as { note?: string } | undefined;

  return {
    id,
    chapterRef: Number(chapterRef),
    title,
    prerequisites: Array.isArray(raw.prerequisites) ? (raw.prerequisites as string[]) : [],
    core: raw.core === true,
    estimatedMinutes: typeof raw.estimated_minutes === "number" ? raw.estimated_minutes : 0,
    keyIdea: typeof raw.key_idea === "string" ? raw.key_idea.trim() : undefined,
    explanation,
    exampleCode,
    challenges: rawChallenges.map((c, i) => parseChallenge(c as Record<string, unknown>, file, i)),
    reviewQuestions: parseReviewQuestions(raw.review_questions, file),
    diagram: typeof raw.diagram === "string" ? raw.diagram : undefined,
    projectTieIn: projectTieIn?.note ? { note: projectTieIn.note } : undefined,
  };
}

/** Resolves content/<language>/units across custom + bundled content roots (see contentDir.ts). */
function findContentDir(language: string): string {
  const resolved = resolveContentPath(path.join(language, "units"));
  if (!resolved) {
    throw new Error(`Couldn't find lesson content for '${language}' (no ${language}/units directory in any content root).`);
  }
  return resolved;
}

/**
 * Loads and validates every unit for a language, sorted by chapter order.
 * Fails loudly: a missing required field, an invalid check_type, or a
 * prerequisite that references a unit id that doesn't exist all throw
 * immediately rather than silently producing a broken lesson track.
 */
export function loadUnits(language: string, contentDirOverride?: string): Unit[] {
  const contentDir = contentDirOverride ?? findContentDir(language);
  const files = readdirSync(contentDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  if (files.length === 0) {
    throw new Error(`No lesson units found in ${contentDir}.`);
  }

  const units = files
    .map((file) => {
      const raw = parse(readFileSync(path.join(contentDir, file), "utf-8")) as Record<string, unknown>;
      return parseUnit(raw, file);
    })
    .sort((a, b) => a.chapterRef - b.chapterRef);

  const ids = new Set(units.map((u) => u.id));
  for (const unit of units) {
    for (const prereq of unit.prerequisites) {
      if (!ids.has(prereq)) {
        throw new Error(`${unit.id}: prerequisite '${prereq}' doesn't match any loaded unit.`);
      }
    }
  }

  return units;
}
