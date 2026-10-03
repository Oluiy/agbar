# Commands: a hands-on walkthrough

Every command, in the order a real user would meet them, with what you should
expect to see. Written to be worked through top to bottom in about 20 minutes -
if anything here surprises you or feels clumsy, that's a UX bug worth fixing
before other people hit it.

Run locally without installing:

```bash
npm run build
alias bq="node $(pwd)/dist/cli.js"
```

Then use `bq` anywhere below. (Or `npm link` and use `buildquick` directly.)

---

## 0. The front door

```bash
bq --help
```

**Expect:** a `Start here:` block listing the five things you can do, *above* the
long list of scaffolding flags. The flags belong to the scaffolder only - the
other four commands are independent.

```bash
bq chekc
```

**Expect:** `Unknown command 'chekc'. Did you mean 'check'?` and exit code 1.

This one matters. The project-name argument accepts anything, so before this
guard existed a typo silently scaffolded a project called `chekc`. If you ever
genuinely want a project with a command-like name, the error tells you how.

---

## 1. `bq check` - grade a repo you didn't write

The one to try first, because it works on code you already have and needs no setup.

```bash
cd ~/some/existing/project
bq check
```

**Expect:** `N/M checks passed  (K not applicable)`, a one-line severity
breakdown (`1 high · 3 medium · 1 low`), then numbered findings sorted
most-severe first under two sections (operational, then structural), each with
the concept that explains it. The numbering is stable between this and
`--fix-plan` - `#3` means the same finding in both.

15 rules now, across 13 of the 76 concepts - including credential-shaped
connection strings, missing circuit breakers, and Express sessions with no
external store, not just the original secrets/rate-limiting/pagination set.

Things to look for while judging it:

- **Are the findings true?** A false positive is worse than a missed one here.
- **"not applicable" should be large** on most repos. Rules skip themselves when
  they can't apply - a repo with no database isn't graded on connection pooling.
- **Test files should never be flagged.** Test code legitimately does things
  production code shouldn't.

```bash
bq check --explain
```

**Expect:** same findings, plus the fix for each concept inline. Use this when
you want the answer without a second command.

```bash
bq check --fix-plan
```

**Expect:** the same findings rendered as a pasteable checklist (`- [ ] ...`)
grouped under the same two section headers, instead of the narrative report -
for turning a check run into a worklist you can drop into an issue.

```bash
bq check --fix-plan --explain
```

**Expect:** the checklist, with the concept's general fix added as a third
line under each item's next step. Combining the two flags used to silently
drop `--explain` - confirm each checklist item actually gains that extra line.

```bash
bq check ./some/other/path
```

Checks any path, not just the current directory.

> It deliberately does **not** do supply-chain security scanning - OpenSSF
> Scorecard does that well and free. This covers application-level concerns only.

---

## 2. `bq concepts` - look something up

```bash
bq concepts
```

**Expect:** 76 concepts grouped by category (Design first, then Reliability,
Performance, Data, Security/Ops).

```bash
bq concepts rate limiting
bq concepts n-plus-one-queries
```

**Expect:** a failure scenario ("where this bites you") and the fix. Matching
works on id or title substring.

```bash
bq concepts queue
```

**Expect:** an *ambiguity* message listing both `message-queues` and
`dead-letter-queues`, rather than silently picking one. Check that this feels
helpful rather than annoying.

---

## 3. `bq learn` - practise, graded by real tests

```bash
bq learn
```

**Expect:** the three tracks of lessons with one-line descriptions, and a
suggestion of where to start. No error, even though you gave no arguments.

### The core loop (try this properly - it's the heart of the product)

```bash
bq learn algorithms
bq learn algorithms 01-token-bucket
```

**Expect:** the explanation, a contrasting example, the challenge prompt, and a
path to a scratch file to edit. The file is real - open it in your editor.

```bash
bq learn algorithms 01-token-bucket --submit implement-token-bucket
```

**Expect (before you write anything):** a failure naming the specific test that
failed, plus a hint. Then actually solve it and re-submit until it passes.

Worth testing deliberately: **write a wrong-but-plausible solution.** For the
token bucket, leave out the capacity cap (`Math.min(capacity, ...)`). You should
fail on `never accumulates beyond capacity` with the message *"an idle client
must not bank unlimited burst"* - the exact mistake the lesson warned about.
If a wrong answer passes, that's a content bug.

```bash
bq learn refactoring 01-extract-the-domain
```

The tests here only pass if you genuinely split the code apart, because they
import the extracted function directly and call it with no request and no
database.

```bash
bq learn rust
```

Requires a Rust toolchain (`rustup`). Without it you should get one clear
message, not a confusing crash.

### Progress

```bash
bq learn algorithms --status
bq learn --review                   # recall quiz across every course
bq learn algorithms --review        # just this course
```

**Expect:** a unit only shows `done` once *every* challenge in it passes, not
just the first one you submitted. A day after that, `--review` starts asking its
recall questions: type the answer from memory, see the right one and why at once.
A right answer comes back later each time (3, 7, 16, 35, 90 days); a wrong one
comes back tomorrow.

> The hidden tests are rewritten from source on every submit, on purpose - they
> sit in your own directory, so editing them to pass would otherwise be trivial.
> Try deleting the test file and re-submitting; it should come back.

---

## 4. `bq tracks` - an order to follow

```bash
bq tracks
bq tracks production-readiness
bq tracks systems-algorithms
```

**Expect:** ordered steps mixing concepts (reading) with lessons (graded).
Concept steps are never marked "done" - nothing was verified, so claiming
otherwise would be dishonest. Lesson steps show your real progress.

Partial names work: `bq tracks interview` finds `interview-prep`.

---

## 5. `bq` - scaffold a project

```bash
mkdir /tmp/demo && cd /tmp/demo
bq
```

**Expect:** interactive prompts (name, stack, structure, database, JWT, Docker),
then a generated project, then tool recommendations and a suggested learning
track based on *what you actually chose*.

Non-interactive:

```bash
bq MyApi --yes --stack springboot --db postgres --jwt --docker
```

**Expect** in the generated project:

- `ARCHITECTURE.md` - why *this* project is shaped this way, with some entries
  linking to the concept behind them
- `LEVELING-UP.md` - the 76 concepts, honestly framed as *not* being in the code

Then close the loop:

```bash
bq check MyApi
```

**Expect:** it flags the generated project for having no rate limiting - a true
positive against our own scaffolder, and exactly the thing
`bq learn algorithms 01-token-bucket` teaches you to build.

Skip the teaching output entirely with `--no-explain`.

---

## 6. Bring your own content

```bash
export BUILDQUICK_CONTENT=./my-standards
bq learn
```

Or put `{"contentDir": "./my-standards"}` in a `.buildquickrc`.

Resolution falls through to the bundled content for anything your directory
doesn't provide, so a team can ship one track or a single unit encoding their
standards and still get everything else.

---

## What to judge it on

1. **Could you tell what to do next, at every step, without reading this file?**
   That's the real test. This document existing is a partial admission of failure.
2. **Did any command dead-end** with an error instead of a suggestion?
3. **Did `check` cry wolf?** One false positive and people uninstall it.
4. **Did a wrong answer ever pass a lesson?**
5. **Was anything slow enough to be annoying?** Lessons should feel instant -
   they need no `npm install`.
