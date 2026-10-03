import * as clack from "@clack/prompts";
import pc from "picocolors";
import { attention, command } from "../../ui/palette.js";
import { loadUnits } from "../loader.js";
import { defaultProgressPath, loadProgress } from "../progress.js";
import { defaultReviewStatePath, loadReviewState, saveReviewState } from "./reviewState.js";
import { dueQuestions, reviewOutlook, runSession, type AnswerResult, type DueQuestion } from "./session.js";

/** CLI glue for `buildquick learn [language] --review`: gather what's due, ask, show feedback, save. */

async function askInTerminal(item: DueQuestion): Promise<string | undefined> {
  const answer = await clack.text({ message: `${pc.dim(`[${item.unit.title}]`)}\n${item.question.question}` });
  return clack.isCancel(answer) ? undefined : answer;
}

function showResult(r: AnswerResult): void {
  const when = new Date(r.nextDueAt).toISOString().slice(0, 10);
  if (r.correct) {
    console.log(`${pc.bold(pc.bgGreen(pc.black(" RIGHT ")))} ${pc.dim(`next review ${when}`)}`);
  } else {
    console.log(
      `${pc.bold(pc.bgRed(pc.white(" NOT QUITE ")))} ${pc.bold("Answer:")} ${pc.green(r.item.question.answer)} ${pc.dim(`- back tomorrow (${when})`)}`
    );
  }
  if (r.item.question.explain) console.log(pc.dim(r.item.question.explain));
  console.log("");
}

/** Says WHY nothing is due and what happens next - two very different situations share the empty queue. */
export function nothingDueMessage(passedUnits: number, nextDueAt: number | undefined): string {
  if (passedUnits === 0) {
    return (
      `\n${pc.bold("Nothing to review yet")} - questions come from lessons you've passed, and you haven't passed one.\n` +
      `Start with ${command("buildquick tracks first-steps")}, or open a lesson: ${command("buildquick learn yaml 1")}.\n` +
      pc.dim("A day after you pass a lesson, its questions show up here, then at growing intervals (3, 7, 16, 35, 90 days).")
    );
  }
  const when = nextDueAt === undefined ? "" : ` Next question due ${attention(new Date(nextDueAt).toLocaleString())}.`;
  return (
    `\n${pc.bold("Nothing due right now.")} You've passed ${passedUnits} lesson${passedUnits === 1 ? "" : "s"}.${when}\n` +
    pc.dim("Recalling something just before you'd forget it is what makes it stick - so questions wait for their interval.")
  );
}

export async function runReview(languages: string[], now: Date = new Date()): Promise<void> {
  // The quiz is typed answers, one at a time. Without a terminal, the prompt
  // library reads piped input but exits before grading it - answers were lost
  // silently with exit code 0. Refuse up front instead.
  if (!process.stdin.isTTY) {
    console.error(pc.red("--review is an interactive quiz - run it in a terminal (stdin isn't one here)."));
    process.exitCode = 1;
    return;
  }
  let total = 0;
  let right = 0;
  let passedUnits = 0;
  let nextDueAt: number | undefined;
  for (const language of languages) {
    const statePath = defaultReviewStatePath(language);
    const state = loadReviewState(statePath);
    const units = loadUnits(language);
    const progress = loadProgress(defaultProgressPath(language));
    const due = dueQuestions(units, progress, state, now);
    if (due.length === 0) {
      const outlook = reviewOutlook(units, progress, state);
      passedUnits += outlook.passedUnits;
      if (outlook.nextDueAt !== undefined && (nextDueAt === undefined || outlook.nextDueAt < nextDueAt)) nextDueAt = outlook.nextDueAt;
      continue;
    }

    console.log(pc.bold(`\n${due.length} ${language} question${due.length === 1 ? "" : "s"} due - answer from memory:\n`));
    const session = await runSession(due, state, now, askInTerminal, showResult);
    // Saved even when stopped early: every answer given still counts.
    saveReviewState(statePath, session.state);
    total += session.results.length;
    right += session.results.filter((r) => r.correct).length;
    if (session.stoppedEarly) break;
  }

  if (total === 0) {
    console.log(nothingDueMessage(passedUnits, nextDueAt));
    return;
  }
  console.log(pc.bold(`${right}/${total} right.`) + pc.dim(" Missed ones come back tomorrow; the rest, later each time you get them right."));
}
