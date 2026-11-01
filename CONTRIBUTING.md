# Contributing to agbar

Thanks for helping. The most valuable contribution is a **false positive**: a finding
`agbar check` reported that was wrong. Precision is this project's top priority -
a checker that cries wolf gets uninstalled.

## Set up

```bash
git clone https://github.com/Oluiy/agbar
cd agbar
npm install
npm run dev -- check path/to/a/repo   # run from source
npm run verify                        # typecheck, lint, format, tests - the same gate CI runs
```

Requires Node 18 or newer.

## How the code fits together

```text
src/
  cli.ts          entry point: parses arguments, wires everything together, owns Ctrl-C
  check/          `agbar check`: read a repo, run rules over it, print the report
  learn/          lessons, grading, tracks, and the spaced-repetition review
  concepts/       the concept library (plain data) behind `agbar concepts`
  stacks/         one folder per scaffold target (FastAPI, Express, Spring Boot, ...)
  engine.ts       generates a chosen stack, then optionally installs and tests it
  prompts.ts, nonInteractive.ts, quickConfig.ts   the ways of answering "what should I build?"
  ui/             the colour palette and the progress display
content/          lessons and tracks, as YAML
```

Tests sit next to the code they cover (`engine.ts` / `engine.test.ts`). `npm run dev -- <command>`
runs any command straight from source.

**`check/`.** `repo.ts` reads a folder into a snapshot. `fileKinds.ts` says what a file *is*
(test, generated, client-side). `matchers.ts` is how rules search it. The rules themselves are
in `operationalRules.ts`, `databaseRules.ts`, `securityRules.ts` and `structuralRules.ts`, and
`rules.ts` assembles them. `runner.ts` runs them and applies inline suppressions,
`reportRender.ts` prints, `redact.ts` masks secrets in anything shown, and `stackAdvice.ts`
gives language-specific versions of a rule's advice.

**`stacks/`.** Every stack implements `StackAdapter` (`src/stacks/StackAdapter.ts`):
questions, validation of the same answers from flags, `generate`, and optionally `verify` and
`nextSteps`. A stack folder usually holds `adapter.ts`, `addons.ts` (questions and
validation), `templates/` (file contents), `install.ts` and `versions.ts`. A new stack is a
new folder plus one line in `cli.ts`; the engine knows nothing about any language. Generating
is all-or-nothing and removes a half-written folder on failure or Ctrl-C; installing and
testing run afterwards and never delete the project.

**`learn/` and `content/`.** Lessons are YAML under `content/<course>/units/`, each graded by
a checker in `src/learn/checkers/`. Concepts are TypeScript objects in `src/concepts/`.

## Conventions

These exist because breaking each one has cost this project something. A reviewer will
ask about them.

- **Every finding links to a concept**, and the concept must exist (a test checks). A finding
  with nothing to teach is a lint rule, and better linters exist.
- **Heuristics are labelled as heuristics.** Rules match text, not a parsed syntax tree, so
  word a finding as "looks like", never as established fact.
- **Match raw text for things that are text, code-only for things that are done.** SQL, URLs
  and keys live inside strings, so search raw text (`firstTextMatch`). "A call is made" or "a
  server is started" must ignore strings and comments (`firstMatch`, `anyCodeMatches`), or a
  test that merely quotes the call counts as the call. This mix-up caused most past false
  positives.
- **`check` makes no network calls, uses no AI and sends no telemetry.** Scaffolding is the
  exception: it downloads through your package manager and Spring Initializr.
- **Content is data.** Adding a lesson or concept should never need an engine change.
- **Validation fails loudly.** Bad lesson YAML or an unsupported flag throws with the file
  and field named; it never quietly generates something other than what was asked for.
- **Anything that writes to disk takes an overridable path**, so tests never touch your real
  `~/.agbar`.
- **Never print a raw matched secret.** Evidence goes through `redact.ts`.
- **Keep files under about 400 lines**, and split before adding to a large one. Not enforced
  by a test, but reviewers will ask.
- **Say "lesson" to users, never "unit"** (the folders are still called `units/`).
- **Use the colour roles in `src/ui/palette.ts`** (`heading`, `command`, `good`, `bad`, `dim`,
  ...) rather than calling the colour library directly, so output stays consistent and still
  reads with colour switched off.
- **Generated-project versions are resolved, not remembered.** Each pin in a `versions.ts` has
  a `// renovate:` comment (a test checks), and every network call needs a timeout.
- **`agbar check .` on this repo stays clean.** Deliberately bad examples in teaching content
  are suppressed per file with `agbar-ignore-file <rule-id>` and a comment saying why.

## Reporting a false positive

Open an issue with: the rule id (e.g. `http-without-timeout`), the file and line it
flagged, and why it is wrong. A link to a public repo is ideal; otherwise paste the
smallest snippet that reproduces it. **Never paste real secrets** - `check` masks them in
its output, but check the text before posting.

## Changing or adding a rule

A rule is an object with an `id`, a `conceptId`, a `severity`, a `passSummary`, a `nextStep`,
`appliesTo` and `detect` (see `RuleDefinition` in `src/check/types.ts`). Put it in the closest
`src/check/*Rules.ts`; if that file is near the size limit, start a new one and add it to
`rules.ts`. If its `nextStep` names specific tools, add a per-language entry in
`stackAdvice.ts` (a test fails until every language is covered).

A rule change is not done until:

1. **A test proves what it must still catch**, not just what it now skips. Every
   false-positive fix needs both: the bad case is silent, and a real case still fires.
   Tests are in `src/check/check.test.ts`.
2. **`npm run verify` passes.**
3. **You've run it on real code.** Point `check` at two or three real repos in different
   stacks and read the source of every new finding. If you keep a corpus of repos,
   `npm run corpus` diffs today's findings against a saved baseline (see
   `corpus/README.md`); give every new `+` line a verdict from the source.

Unit tests prove a rule works on examples written to make it work. Only real code shows
where it is wrong.

## Changing the advice a finding gives

The `Next:` line is the part a reader acts on, so it is pinned by a snapshot
(`src/check/advice.test.ts`). Editing a rule's `nextStep`, or any per-language advice in
`stackAdvice.ts`, fails that test on purpose. Run `npx vitest -u src/check/advice.test.ts`
and put the snapshot diff in your PR - that diff is the review.

Advice names real packages and real API calls. Check the package still exists and still
has that API before you write it; the snapshot proves nobody changed the advice unnoticed,
not that the advice is right.

## Adding a lesson or concept

Lessons and concepts are content, not code, and live under `content/` and
`src/concepts*`. Each lesson ships a starter that must fail and a reference fix that must
pass - the test suite enforces this.

- **A concept** is an object in a file under `src/concepts/`. It needs an example (or
  per-runtime examples), and its id goes in the sorted list in `src/concepts.test.ts`, which
  fails with a diff naming the concept that appeared. JavaScript examples must parse, and an
  acronym must be explained where the lesson first uses it (`src/learn/jargon.test.ts`).
  A single `example` that isn't JavaScript must say so with `exampleLanguage` ("SQL",
  "C#", ...), so a reader on another stack doesn't copy it blindly. If the idea looks different
  in each language, give `examples` (one snippet per language) instead, as `circuit-breakers`
  does. Check any library API you write against its docs or source first, and add
  `references` with links you have opened.
- **A lesson** is a YAML file under `content/<course>/units/`. A brand-new course also needs a
  checker registered in `src/learn/learnCommand.ts`.

## Pull requests

- Keep one change per PR, and say why in the description.
- Run `npm run format` before pushing. CI checks formatting and will fail the PR otherwise.
- Don't commit generated output (`dist/`) or any real credentials.

## License

By contributing you agree that your contribution is licensed under the project's
[MIT License](LICENSE).
