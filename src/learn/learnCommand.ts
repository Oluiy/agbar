import pc from "picocolors";
import { codeBlock, emphasize } from "../terminalText.js";
import { attention, command, count, dim, good, heading, label, name, nextStep, path, progress as progressOf, shortPath, tag } from "../ui/palette.js";
import { nodeChecker } from "./checkers/nodeChecker.js";
import { rustChecker } from "./checkers/rustChecker.js";
import { yamlChecker } from "./checkers/yamlChecker.js";
import { compositeChecker } from "./checkers/compositeChecker.js";
import { predictionChecker } from "./checkers/predictionChecker.js";
import { regexChecker } from "./checkers/regexChecker.js";
import { loadUnits } from "./loader.js";
import { defaultProgressPath, loadProgress, recordAttempt, statusFor, type ProgressMap, type UnitStatus } from "./progress.js";
import type { Checker, Unit } from "./types.js";
import { ensureChallengeWorkspace } from "./workspace.js";
import { loadLastOpened, saveLastOpened } from "./lastOpened.js";
import { nextStepAfterPass, pickChallenge, resolveLesson } from "./navigation.js";

/** Same look-and-feel as conceptsCommand.ts - grouped/colored terminal output for a standalone, no-project-required command. */

const CHECKERS: Record<string, Checker> = {
  rust: rustChecker,
  // The systems algorithms behind the concepts - token bucket, LRU, consistent
  // hashing - graded in JavaScript because agbar already is Node, so they
  // run for every user with no extra toolchain.
  algorithms: nodeChecker,
  // Structure, graded by behaviour: the tests can only pass if the code was
  // actually split apart, since they import the extracted piece directly.
  refactoring: nodeChecker,
  // GitHub Actions workflows, cron schedules and config files - graded by what
  // the YAML means once parsed, so any correct spelling of an answer passes.
  yaml: yamlChecker,
  // Reading and debugging AI-written code: "predict what this prints" and "find
  // the bug". Two kinds of challenge, each graded by its own checker.
  reading: compositeChecker({ predict_output: predictionChecker, test_passes: nodeChecker }),
  // Regular expressions: write patterns graded against must-match / must-reject
  // cases, and predict what tricky regex code prints.
  regex: compositeChecker({ regex_cases: regexChecker, predict_output: predictionChecker }),
  // Authorisation bugs, graded by behaviour: the tests use two accounts, because a
  // suite written by one logged-in user passes whether or not the check exists.
  security: nodeChecker,
  // The small traps that break production: text, numbers, time, APIs, files.
  traps: compositeChecker({ predict_output: predictionChecker, test_passes: nodeChecker }),
};

export const SUPPORTED_LEARN_LANGUAGES = Object.keys(CHECKERS);

/** A glyph AND a word: the word still says it when colour is stripped. Padded so a column lines up. */
export function statusLabel(status: UnitStatus): string {
  if (status === "done") return good("✓ done       ");
  if (status === "in_progress") return pc.yellow("● in progress");
  return dim("○ not started");
}

function requireLanguage(language: string): Checker | undefined {
  const checker = CHECKERS[language];
  if (!checker) {
    console.error(pc.red(`No lessons for '${language}' yet. Supported: ${SUPPORTED_LEARN_LANGUAGES.join(", ")}.`));
    process.exitCode = 1;
    return undefined;
  }
  return checker;
}

/** Shown when `agbar learn` is run with no language - a menu beats an error. */
export function printLearnLanguages(): void {
  const blurbs: Record<string, string> = {
    algorithms: "Token bucket, backoff, LRU, consistent hashing - the algorithms behind the concepts",
    refactoring: "Split tangled code apart; the tests only pass if you actually did",
    yaml: "What YAML really means, GitHub Actions behind the scenes, and cron schedules",
    reading: "Read and debug AI-written code: predict what it prints, find the bug it hides",
    regex: "Regular expressions and the small things people miss: anchors, greedy vs lazy, the g flag, ReDoS",
    traps: "Small things that break production: Unicode, money, big IDs, NaN, DST, leap days, path traversal",
    rust: "The Rust language itself, from cargo new through ownership",
  };
  // One row per course with its size and YOUR progress in it - the numbers are
  // what make a list scannable (Idari's map ranks rows the same way).
  const rows = SUPPORTED_LEARN_LANGUAGES.map((language) => {
    const units = loadUnits(language);
    const done = units.filter((u) => statusFor(loadProgress(defaultProgressPath(language)), u.id) === "done").length;
    return { language, total: units.length, done };
  });
  const totalLessons = rows.reduce((n, r) => n + r.total, 0);
  const width = Math.max(...rows.map((r) => r.language.length));

  console.log(`\n${heading("Courses")} ${dim(`${rows.length} courses · ${totalLessons} lessons, each graded as you go`)}\n`);
  for (const { language, total, done } of rows) {
    console.log(`  ${name(language.padEnd(width))}  ${count(total)} ${dim("lessons")} ${dim("·")} ${progressOf(done, total)} ${dim("done")}`);
    if (blurbs[language]) console.log(`  ${" ".repeat(width)}  ${dim(blurbs[language])}`);
  }
  console.log(`\n${label("Open a course:")} ${command("agbar learn <course>")}   ${dim("e.g.")} ${command("agbar learn traps")}`);
  // Algorithms (token buckets, consistent hashing) is not where a beginner
  // starts; the beginner track is ordered so each step needs only the last one.
  console.log(nextStep("new here? a guided path:", "agbar tracks first-steps"));
}

export function printUnitList(language: string): void {
  if (!requireLanguage(language)) return;
  const units = loadUnits(language);
  const progress = loadProgress(defaultProgressPath(language));

  const done = units.filter((u) => statusFor(progress, u.id) === "done").length;
  console.log(`\n${heading(language)} ${dim("·")} ${progressOf(done, units.length)} ${dim("lessons done")}\n`);
  // "core" only means something when some lessons are optional; if every lesson
  // has it, the tag is noise on every row.
  const someOptional = units.some((u) => !u.core);
  units.forEach((unit, i) => {
    const marker = someOptional ? (unit.core ? `  ${tag("[core]")}` : `  ${dim("[optional]")}`) : "";
    const mins = unit.estimatedMinutes ? dim(`  ~${unit.estimatedMinutes} min`) : "";
    console.log(`  ${statusLabel(statusFor(progress, unit.id))}  ${count(`${i + 1}.`)} ${name(unit.title)}${marker}${mins}`);
  });
  const next = units.findIndex((u) => statusFor(progress, u.id) !== "done");
  console.log(
    `\n${nextStep(next === -1 ? "all done - more to learn:" : "open lesson " + (next + 1) + ":", next === -1 ? "agbar tracks" : `agbar learn ${language} ${next + 1}`)}  ${dim("(a number, or any part of its name)")}`
  );
}

/** A lesson by id, number or part of its name - see navigation.ts. */
function findUnit(units: Unit[], query: string, language: string): Unit | undefined {
  const unit = resolveLesson(units, query);
  if (!unit) {
    console.error(
      pc.red(`No single lesson matches '${query}' in ${language}.`) + ` Run ${command(`agbar learn ${language}`)} to see them, then use the number.`
    );
    process.exitCode = 1;
  }
  return unit;
}

export function printUnitDetail(language: string, unitId: string): void {
  const checker = requireLanguage(language);
  if (!checker) return;
  const units = loadUnits(language);
  const unit = findUnit(units, unitId, language);
  if (!unit) return;
  saveLastOpened({ language, unitId: unit.id });

  // A header that says where you are, then headed sections - so a long lesson is
  // three things you can jump between, not one wall of text.
  const at = units.indexOf(unit) + 1;
  const mins = unit.estimatedMinutes ? ` · about ${unit.estimatedMinutes} min` : "";
  const n = unit.challenges.length;
  console.log(`\n${heading(unit.title)}`);
  console.log(dim(`${language} · lesson ${at} of ${units.length}${mins} · ${n} challenge${n === 1 ? "" : "s"}`));

  // Before the prose, not inside it: a reader who skims gets the spine, and a reader
  // returning to a half-finished lesson re-enters without re-reading the explanation.
  if (unit.keyIdea) console.log(`\n${attention(unit.keyIdea)}`);

  console.log(`\n${heading("What to know")}\n`);
  console.log(emphasize(unit.explanation.trim()));
  console.log(`\n${heading("Example")}\n\n${codeBlock(unit.exampleCode)}`);

  console.log(`\n${heading("Your turn")}`);
  unit.challenges.forEach((challenge, i) => {
    const workspaceDir = ensureChallengeWorkspace(language, unit.id, challenge, checker);
    console.log(`\n${attention(`Challenge ${i + 1} of ${n}`)} ${dim("·")} ${name(challenge.id)}\n`);
    console.log(emphasize(challenge.prompt.trim()));
    // The two lines a learner must act on - the file and the command - are the
    // brightest on the page, and the path is shortened to what matters.
    console.log(`\n  ${label("Edit")}   ${path(shortPath(checker.solutionPath(workspaceDir, challenge)))}`);
    console.log(`  ${label("Then")}   ${command(`agbar submit ${challenge.id}`)}`);
    if (challenge.hint) console.log(dim("  (a hint appears if it fails - try it first)"));
  });

  if (unit.projectTieIn?.note) {
    console.log(`\n${heading("Why it matters")}\n\n${unit.projectTieIn.note}`);
  }
  console.log(n > 1 ? `\n${dim("Plain")} ${command("agbar submit")} ${dim("grades the first challenge you haven't passed.")}\n` : "");
}

/** Every pass ends on one concrete next step, so nobody has to remember the map. */
function printNextStep(language: string, units: Unit[], progress: ProgressMap, unit: Unit, checker: Checker): void {
  const next = nextStepAfterPass(units, progress, unit);
  if (next.kind === "challenge") {
    const dir = ensureChallengeWorkspace(language, unit.id, next.challenge, checker);
    console.log(`\n${pc.bold(pc.green("Next:"))} the other challenge in this lesson, ${name(next.challenge.id)}`);
    console.log(`  ${label("Edit")}   ${path(shortPath(checker.solutionPath(dir, next.challenge)))}`);
    console.log(`  ${label("Then")}   ${command("agbar submit")}`);
    return;
  }
  console.log(`\n${good("Lesson complete.")} ${dim("Its recall questions start tomorrow in")} ${command("agbar learn --review")}${dim(".")}`);
  if (next.kind === "lesson") {
    console.log(nextStep(`${next.unit.title} -`, `agbar learn ${language} ${units.indexOf(next.unit) + 1}`));
  } else {
    console.log(`${good(`You've finished every ${language} lesson.`)} ${nextStep("more to learn:", "agbar tracks")}`);
  }
}

/** `agbar submit [challenge]`: grades the lesson you last opened, so nothing needs retyping. */
export async function submitLastOpened(challengeId?: string): Promise<void> {
  const last = loadLastOpened();
  if (!last) {
    console.error(pc.red("No lesson opened yet.") + ` Open one first, e.g. ${command("agbar learn yaml 1")} - then ${command("agbar submit")} grades it.`);
    process.exitCode = 1;
    return;
  }
  await submitChallenge(last.language, last.unitId, challengeId);
}

export async function submitChallenge(language: string, unitId: string, challengeId?: string): Promise<void> {
  const checker = requireLanguage(language);
  if (!checker) return;

  const units = loadUnits(language);
  const unit = findUnit(units, unitId, language);
  if (!unit) return;
  saveLastOpened({ language, unitId: unit.id });

  const progressPath = defaultProgressPath(language);
  const challenge = pickChallenge(unit, loadProgress(progressPath), challengeId);
  if (!challenge) {
    console.error(pc.red(`No challenge '${challengeId}' in this lesson.`) + ` It has: ${unit.challenges.map((c) => name(c.id)).join(", ")}.`);
    process.exitCode = 1;
    return;
  }

  const workspaceDir = ensureChallengeWorkspace(language, unit.id, challenge, checker);
  const result = await checker.run(challenge, workspaceDir);
  const allChallengeIds = unit.challenges.map((c) => c.id);
  const progress = recordAttempt(progressPath, unit.id, challenge.id, result.passed, allChallengeIds);

  if (result.passed) {
    console.log(`${pc.bold(pc.bgGreen(pc.black(" PASSED ")))} ${name(challenge.id)}`);
    printNextStep(language, units, progress, unit, checker);
    return;
  }

  console.log(`${pc.bold(pc.bgRed(pc.white(" NOT YET ")))} ${name(challenge.id)}`);
  console.log(result.message);
  if (challenge.hint) console.log(`\n${attention("Hint:")} ${challenge.hint}`);
  // A failed try always ends on what to do: fix the file, run the same command.
  console.log(`${dim("Edit, then run")} ${command("agbar submit")} ${dim("again.")}`);
  process.exitCode = 1;
}

/*
 * Review lives in review/: `learn --review` quizzes individually scheduled recall
 * questions (review/reviewCommand.ts). It replaced a list of units passed N days
 * ago, which prompted re-reading - and re-reading doesn't strengthen memory the
 * way recalling does.
 */

export function printStatus(language: string): void {
  if (!requireLanguage(language)) return;
  const units = loadUnits(language);
  const progress = loadProgress(defaultProgressPath(language));

  console.log(`\n${heading(`${language} progress`)}\n`);
  for (const unit of units) {
    const info = progress[unit.id];
    const attempts = info ? dim(`  ${info.attempts} attempt${info.attempts === 1 ? "" : "s"}`) : "";
    console.log(`  ${statusLabel(statusFor(progress, unit.id))}  ${name(unit.title)}${attempts}`);
  }
}
