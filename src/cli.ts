#!/usr/bin/env node
import { Command } from "commander";
import * as clack from "@clack/prompts";
import pc from "picocolors";
import { runPrompts } from "./prompts.js";
import { resolveNonInteractive, type NonInteractiveFlags } from "./nonInteractive.js";
import { CancelledError, generateProject } from "./engine.js";
import { adonisAdapter } from "./stacks/adonis/adapter.js";
import { aspnetcoreAdapter } from "./stacks/aspnetcore/adapter.js";
import { axumAdapter } from "./stacks/axum/adapter.js";
import { djangoAdapter } from "./stacks/django/adapter.js";
import { fastapiAdapter } from "./stacks/fastapi/adapter.js";
import { nestjsAdapter } from "./stacks/nestjs/adapter.js";
import { expressAdapter, fastifyAdapter } from "./stacks/node/adapter.js";
import { abortOnInterrupt } from "./interrupt.js";
import { printVerifyResult } from "./scaffoldReport.js";
import { createTerminalReporter } from "./ui/progress.js";
import { springbootAdapter } from "./stacks/springboot/adapter.js";
import type { StackAdapter } from "./stacks/StackAdapter.js";
import { printCheck } from "./check/checkCommand.js";
import { printConceptDetail, printConceptsList } from "./conceptsCommand.js";
import {
  printLearnLanguages,
  printStatus,
  printUnitDetail,
  printUnitList,
  submitChallenge,
  submitLastOpened,
  SUPPORTED_LEARN_LANGUAGES,
} from "./learn/learnCommand.js";
import { runReview } from "./learn/review/reviewCommand.js";
import { printTrackDetail, printTracksList } from "./learn/tracksCommand.js";
import { printCronSchedule } from "./learn/cronCommand.js";
import { printRegexReport } from "./learn/regex/regexCommand.js";
import { runWelcome, shouldShowWelcome } from "./welcome.js";
import { printLearningSuggestions, printRecommendations, writeTeachingDocs } from "./postGenerate.js";

const stacks: StackAdapter[] = [
  aspnetcoreAdapter,
  springbootAdapter,
  fastapiAdapter,
  djangoAdapter,
  nestjsAdapter,
  expressAdapter,
  fastifyAdapter,
  adonisAdapter,
  axumAdapter,
];

const COMMAND_NAMES = ["concepts", "learn", "check", "tracks", "cron", "regex", "submit"];

function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

/**
 * The project name argument swallows anything, so a mistyped command used to
 * silently start scaffolding a project named after the typo - `agbar chekc`
 * would generate ./chekc rather than saying "did you mean check?". Catch the
 * near-misses before generation starts.
 */
function misspelledCommand(arg: string | undefined): string | undefined {
  if (!arg) return undefined;
  const lower = arg.toLowerCase();
  return COMMAND_NAMES.find((name) => name !== lower && editDistance(lower, name) <= 2);
}

const program = new Command();

program
  .name("agbar")
  .description("Interactive universal backend scaffolder: pick a stack and get a fully-wired, Clean-Architecture-shaped solution in seconds.")
  .version("0.1.0")
  .argument("[projectName]", "Project name (skips the name prompt)")
  .option("-y, --yes", "Run non-interactively, filling in anything unspecified with defaults (requires --stack, or set it in --config)")
  .option("--config <path>", "Path to a JSON config file for non-interactive generation - see README")
  .option("--stack <id>", `Stack to generate: ${stacks.map((s) => s.id).join(" | ")}`)
  .option("--structure <mode>", "Project layout. Spring Boot: multi-module | package-by-layer | package-by-feature. Others: layered | clean | modular | ...")
  .option("--four-layer", "Spring Boot multi-module: use 4 layers (API/Application/Domain/Infrastructure)")
  .option("--three-layer", "Spring Boot multi-module: use 3 layers (API/Application/Domain)")
  .option("--db <provider>", "Database: sqlite | postgres (Spring Boot: none | postgres | mysql; FastAPI also: none)")
  .option("--orm <name>", "Express/Fastify ORM: prisma | drizzle | typeorm | sequelize | none")
  .option("--jwt", "Include JWT authentication boilerplate")
  .option("--docker", "Include Dockerfile & docker-compose.yml")
  .option("--no-tests", "Skip generating a test project (included by default)")
  .option("--microservice", "Generate independent services instead of one monolith")
  .option("--services <names>", "Comma-separated service names (implies --microservice)")
  .option("--port <number>", "Base HTTP port (default: 8080)")
  .option("--llm-api", "This project calls an LLM API (OpenAI/Anthropic/Groq/...) - drives the ai-cost-guard recommendation")
  .option("--no-explain", "Skip generating ARCHITECTURE.md and LEVELING-UP.md (the teaching output)")
  .action(async (projectNameArg: string | undefined, opts: NonInteractiveFlags & { yes?: boolean; explain?: boolean }) => {
    const typo = misspelledCommand(projectNameArg);
    if (typo) {
      console.error(pc.red(`Unknown command '${projectNameArg}'. Did you mean '${typo}'?`));
      console.error(pc.dim(`If you really meant to scaffold a project called '${projectNameArg}', run: agbar ${projectNameArg} --stack springboot`));
      process.exitCode = 1;
      return;
    }

    if (shouldShowWelcome(projectNameArg, opts) && !(await runWelcome())) return;

    const nonInteractive = Boolean(opts.yes || opts.config);
    try {
      const { config, adapter } = nonInteractive ? resolveNonInteractive(stacks, opts, projectNameArg) : await runPrompts(stacks, projectNameArg);

      // Ctrl-C belongs to us, not to the spinner or the installer: the first press aborts the
      // signal, the engine stops what is running and tidies up, and control returns here.
      const abort = new AbortController();
      const stopListening = abortOnInterrupt(abort, () => console.log(pc.dim("\nStopping... (press Ctrl-C again to quit immediately)")));
      let result;
      try {
        result = await generateProject(config, adapter, { reporter: createTerminalReporter(), signal: abort.signal });
      } finally {
        stopListening();
      }
      const { outDir, verify } = result;
      printVerifyResult(verify, config, adapter);
      if (verify?.cancelled) {
        process.exitCode = 130;
        return;
      }
      printRecommendations(config, adapter);
      if (opts.explain !== false) {
        writeTeachingDocs(outDir, config, adapter);
        printLearningSuggestions(config, adapter);
      }

      const doneMessage = pc.green(`Done. cd into "${config.projectName}" to get started.`);
      if (nonInteractive) {
        console.log(doneMessage);
      } else {
        clack.outro(doneMessage);
      }
    } catch (err) {
      if (err instanceof CancelledError) {
        console.log("Cancelled. Nothing was created.");
        process.exitCode = 130;
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      // clack.log.error assumes an active prompt session (intro() was called);
      // a plain stderr line is the right shape for a scripted/CI run instead.
      if (nonInteractive) {
        console.error(pc.red(message));
      } else {
        clack.log.error(message);
      }
      process.exitCode = 1;
    }
  });

program
  .command("concepts")
  .description("Browse backend engineering concepts (idempotency, caching, rate limiting, ...) - no project needed")
  .argument("[query]", "Concept name or id to see the full explanation for (omit to list everything)")
  .action((query?: string) => {
    if (query) {
      printConceptDetail(query);
    } else {
      printConceptsList();
    }
  });

program
  .command("learn")
  .description("Interactive lessons, graded by real checks - independent of scaffolding a project")
  .argument("[course]", "A course: traps | regex | yaml | reading | algorithms | refactoring | rust (omit to see them all)")
  .argument("[lesson]", "A lesson's number (1, 2...) or any part of its name (omit to list the lessons)")
  .option("--submit <challengeId>", "Grade a challenge in this lesson (or just use: agbar submit)")
  .option("--status", "Show your progress instead of listing/opening units")
  .option("--review", "Quiz yourself on what's due (all languages if none given); questions return at growing intervals")
  .action(async (language: string | undefined, unitId: string | undefined, opts: { submit?: string; status?: boolean; review?: string | boolean }) => {
    if (opts.review !== undefined) {
      // `--review 30` from before questions were scheduled individually: still accepted, so old commands don't break.
      if (typeof opts.review === "string") console.log(pc.dim("(--review no longer takes a number of days: each question now has its own schedule.)"));
      if (language && !SUPPORTED_LEARN_LANGUAGES.includes(language)) {
        console.error(pc.red(`No lessons for '${language}' yet. Supported: ${SUPPORTED_LEARN_LANGUAGES.join(", ")}.`));
        process.exitCode = 1;
        return;
      }
      await runReview(language ? [language] : SUPPORTED_LEARN_LANGUAGES);
      return;
    }
    if (!language) {
      printLearnLanguages();
      return;
    }
    if (opts.status) {
      printStatus(language);
    } else if (opts.submit && unitId) {
      await submitChallenge(language, unitId, opts.submit);
    } else if (unitId) {
      printUnitDetail(language, unitId);
    } else {
      printUnitList(language);
    }
  });

program
  .command("check")
  .description("Grade an existing repo against the backend concepts - every finding links to the concept that explains it")
  .argument("[path]", "Repo to check (default: current directory)", ".")
  .option("--explain", "Include the fix for each concept inline")
  .option("--fix-plan", "Render findings as a pasteable checklist instead of the narrative report")
  .option("--json", "Emit the report as a single JSON object - no color, no narrative lines mixed in")
  .option("--report-gap [findingNumber]", "Report a wrong finding (by number) or an unrecognized stack - opens your mail client, nothing sends automatically")
  .option("--note <text>", "A note to include with --report-gap")
  .option("--include-evidence", "Include the flagged source line with --report-gap (off by default - metadata only)")
  .action(
    (
      targetPath: string,
      opts: { explain?: boolean; fixPlan?: boolean; json?: boolean; reportGap?: string | boolean; note?: string; includeEvidence?: boolean }
    ) => {
      let reportGap: number | true | undefined;
      if (opts.reportGap === true) reportGap = true;
      else if (typeof opts.reportGap === "string") {
        const n = Number(opts.reportGap);
        if (Number.isNaN(n)) {
          console.error(pc.red(`--report-gap expects a finding number, got '${opts.reportGap}'.`));
          process.exitCode = 1;
          return;
        }
        reportGap = n;
      }
      printCheck(targetPath, {
        explain: opts.explain === true,
        fixPlan: opts.fixPlan === true,
        json: opts.json === true,
        reportGap,
        note: opts.note,
        includeEvidence: opts.includeEvidence === true,
      });
    }
  );

program
  .command("tracks")
  .description("Ordered learning paths through the concepts and lessons, grouped by audience")
  .argument("[trackId]", "Track to open (omit to list them all)")
  .action((trackId: string | undefined) => {
    if (trackId) {
      printTrackDetail(trackId);
    } else {
      printTracksList();
    }
  });

program
  .command("cron")
  .description("Show when a cron expression will actually fire (UTC and your local time)")
  .argument("<expression>", 'Quote it, e.g. "30 9 * * 1-5"')
  .option("-n, --count <n>", "How many upcoming runs to show", "5")
  .action((expression: string, opts: { count: string }) => {
    printCronSchedule(expression, Number(opts.count));
  });

program
  .command("submit")
  .description("Grade your answer for the lesson you last opened - no need to retype it")
  .argument("[challengeId]", "Which challenge (omit for the first one you haven't passed)")
  .action(async (challengeId: string | undefined) => {
    await submitLastOpened(challengeId);
  });

program
  .command("regex")
  .description("Show what a regex matches in your text, highlighted, plus the classic pitfalls in it")
  .argument("<pattern>", "Quote it: '^\\d{5}$' or '/^\\d{5}$/i'")
  .argument("[texts...]", "Text to try it on")
  .option("-f, --flags <flags>", "Flags for a bare pattern, e.g. i or gm", "")
  .action((pattern: string, texts: string[], opts: { flags: string }) => {
    printRegexReport(pattern, texts, opts.flags);
  });

// The scaffolding flags below are long, and a first-time reader hits them before
// the command list. This puts the four things you can actually do at the top.
program.addHelpText(
  "beforeAll",
  `
New here? Run  agbar  on its own for a menu.

Learn
  agbar tracks first-steps   A guided path - the easiest place to start
  agbar learn                Courses of short lessons, graded as you go
  agbar submit               Grade your answer for the lesson you're on
  agbar learn --review       Quick quiz on what you've learned, so it sticks
  agbar concepts <word>      Look anything up: concepts money, concepts timeout

Check
  agbar check                Find problems in a project, with why each matters
  agbar regex '<re>' text    See what a regex matches, and its pitfalls
  agbar cron "<expr>"        See exactly when a schedule will run

Build
  agbar <ProjectName>        Create a new backend project
`
);

program.addHelpText(
  "after",
  "\nRun 'agbar concepts' any time - during scaffolding or in the middle of writing your own code - to look up things like caching, rate limiting, or idempotency without leaving the terminal." +
    "\nRun 'agbar learn rust' for interactive lessons with real pass/fail checks, independent of scaffolding a project." +
    "\nRun 'agbar tracks' for ordered paths through both, for students, interview prep, production readiness, or onboarding." +
    '\nTeams can ship their own lessons and tracks by pointing AGBAR_CONTENT (or .agbarrc\'s "contentDir") at their own content directory.'
);

// Every "fail loudly" error (a corrupted progress file, a broken lesson, a bad
// .agbarrc) is written to be read by a person: print the message, not a
// stack trace. AGBAR_DEBUG=1 brings the trace back for bug reports.
program.parseAsync().catch((err: unknown) => {
  const error = err instanceof Error ? err : new Error(String(err));
  console.error(pc.red(error.message));
  if (process.env.AGBAR_DEBUG) console.error(error.stack);
  process.exitCode = 1;
});
