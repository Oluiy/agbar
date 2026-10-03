import * as clack from "@clack/prompts";
import pc from "picocolors";
import { printCheck } from "./check/checkCommand.js";
import { printConceptDetail, printConceptsList } from "./conceptsCommand.js";
import { printTrackDetail } from "./learn/tracksCommand.js";
import type { NonInteractiveFlags } from "./nonInteractive.js";

/**
 * What bare `buildquick` shows a person at a terminal. It used to start the
 * project scaffolder's questions straight away - so someone who came to learn
 * landed on "Project name?". Now it asks what they're here for; scaffolding is
 * one option, and `buildquick MyApi` or any flag still goes straight to it.
 */

/** True only for a person typing plain `buildquick` - scripts, pipes and flags keep the old behaviour. */
export function shouldShowWelcome(projectNameArg: string | undefined, opts: NonInteractiveFlags & { yes?: boolean }): boolean {
  if (projectNameArg || !process.stdin.isTTY || !process.stdout.isTTY) return false;
  const scaffoldFlag =
    opts.yes ||
    opts.config ||
    opts.stack ||
    opts.structure ||
    opts.fourLayer ||
    opts.threeLayer ||
    opts.db ||
    opts.jwt ||
    opts.docker ||
    opts.microservice ||
    opts.services ||
    opts.port ||
    opts.llmApi ||
    opts.tests === false;
  return !scaffoldFlag;
}

/** Returns true when the user chose to scaffold, so the caller carries on into that flow. */
export async function runWelcome(): Promise<boolean> {
  const choice = await clack.select({
    message: "What would you like to do?",
    options: [
      { value: "learn", label: "Learn something", hint: "a guided path for beginners" },
      { value: "check", label: "Check the code in this folder", hint: "problems, and why each matters" },
      { value: "concepts", label: "Look up a concept", hint: "caching, timeouts, money in floats..." },
      { value: "scaffold", label: "Create a new backend project" },
    ],
  });
  if (clack.isCancel(choice)) return false;

  if (choice === "learn") {
    printTrackDetail("first-steps");
    console.log(`\n${pc.bold("Start with step 1 above.")} Every lesson ends by telling you what to do next.`);
  } else if (choice === "check") {
    printCheck(process.cwd(), { explain: false, fixPlan: false, json: false, includeEvidence: false });
  } else if (choice === "concepts") {
    const word = await clack.text({ message: "What do you want to look up? (a word is enough - leave empty to list everything)" });
    if (clack.isCancel(word)) return false;
    if (word.trim()) printConceptDetail(word);
    else printConceptsList();
  }
  return choice === "scaffold";
}
