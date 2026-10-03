# buildquick — What This Project Actually Is

A plain-language walkthrough of what exists today, how it fits together, and what it
deliberately doesn't do. Written to be handed to someone who has never seen the repo.

Current state, verified rather than estimated: **15 check rules, 76 concepts,
12 learning tracks, 22 lesson units, 407 passing tests.** Not yet published to npm.

---

## 1. The one-sentence version

`buildquick` is a command-line tool that **scaffolds a backend project, grades an
existing one, and teaches the engineering concepts behind both** — with deterministic
pass/fail checks, no AI, no network calls, and no account.

The package name on npm will be `buildquick`. The repo is called `aggregator`.

---

## 2. The problem it exists to solve

Most code in a repository today was generated or heavily assisted by an AI, and the
person shipping it often cannot fully explain it. The research term for this is
**comprehension debt**.

The dividing line isn't whether you use AI. It's whether you can *evaluate* what it
gives you. A developer who has personally implemented a token bucket will spot that an
AI-generated rate limiter never caps the bucket. A developer who has only read a
paragraph about rate limiting won't.

So the goal is not "stop using AI." The goal is: **be able to judge the code you're
shipping.** Everything in this tool points at that.

---

## 3. What it does — four capabilities

### 3.1 `buildquick` — scaffold a project

Interactive prompts (or flags for CI) produce a fully-wired backend project.

```bash
buildquick                                                    # interactive
buildquick MyApi --yes --stack springboot --db postgres --jwt --docker
```

**Supported stacks:**
- **Spring Boot** — fully native. Three project structures (Multi-Module,
  Package-by-Layer, Package-by-Feature), PostgreSQL/MySQL via Spring Data JPA,
  Spring Security + JWT, Docker, JUnit smoke tests, Maven Wrapper. Monolith or
  microservices.
- **ASP.NET Core** — a thin wrapper that shells out to a separate tool
  (`BuildQuickPkg`), so .NET generation logic isn't duplicated here.
- **Rust** — *not built.* Listed as planned only.

**What's unusual:** every generated project also gets two documents.

- `ARCHITECTURE.md` — why *this* project is shaped this way, tied to the real classes
  that were written. Pick Multi-Module and it explains how Maven physically enforces
  dependency direction at compile time.
- `LEVELING-UP.md` — the 76 concepts, framed honestly as things the scaffold *doesn't*
  give you.

Then it suggests a learning track based on what you actually selected — pick a database
and it points at pagination and N+1 queries specifically, not a generic reading list.

### 3.2 `buildquick check` — grade a repo you didn't write

Runs on any existing repository. No scaffolding required.

```bash
buildquick check                  # grade current directory
buildquick check --explain        # include each concept's fix inline
buildquick check --fix-plan       # render as a pasteable checklist
```

Output looks like:

```
6/11 checks passed  (3 not applicable)
1 high · 3 medium · 1 low

Will this survive traffic?

1. HIGH   A .env file exists but .gitignore doesn't cover it...
       .env
       Next: Add `.env` to `.gitignore` right now, then rotate every credential...
       Learn why: buildquick concepts secrets-management
```

**15 rules, in two groups that answer different questions:**

| Group | Question | Rules |
| --- | --- | --- |
| **Operational** | Will this survive traffic? | unignored `.env`, committed private keys, hardcoded DB credentials, missing rate limiting, missing healthcheck, unbounded `SELECT *`, DB calls in loops, HTTP without timeouts, no connection pooling, no circuit breaker, in-memory session store, no schema migrations |
| **Structural** | Can a person still change it? | oversized files, handlers touching the database directly, constructors with too many dependencies |

**Two rules the module holds itself to:**

1. **Every finding must link to a concept.** A finding with nothing to teach is just a
   lint rule, and better linters exist. This has a real cost — a planned
   schema-migrations rule was once dropped because no concept covered schema versioning.
   Writing the `schema-migrations` concept is what unblocked it; the rule ships now.
   The ordering is the convention working, not an obstacle to route around.
2. **Heuristics are reported as heuristics.** These are text patterns, not an AST or
   type checker. The output says so explicitly. Rules skip themselves when they can't
   apply, and ignore test code.

It deliberately does **not** do supply-chain security scanning — OpenSSF Scorecard does
that well and free. This covers application-level concerns only.

### 3.3 `buildquick concepts` and `buildquick tracks` — reference and paths

```bash
buildquick concepts                       # 76 concepts, grouped by category
buildquick concepts rate limiting         # one concept in full
buildquick tracks                         # 11 ordered paths (beginners: first-steps)
buildquick tracks production-readiness    # open one
```

Each concept is a **concrete failure scenario paired with the mechanism that prevents
it** — not a definition. Example:

> **Idempotency keys.** *Where this bites you:* A user's withdrawal request times out,
> so they click again — maybe a third time. Without protection, your system processes
> all three. *The fix:* Attach a unique idempotency key. If the same key arrives again,
> return the original result instead of processing it twice.

Concepts that involve a real judgement call also carry a **"When to reach for it"**
section and links for further reading — `microservices-vs-monolith` tells you the
thresholds under which a modular monolith is the right answer; `rate-limiting` reduces
the algorithm choice to one question (do legitimate clients burst?).

Tracks are ordered paths for specific audiences: `architecture-decisions`,
`distributed-writes`, `caching-in-depth`, `student-backend`, `production-readiness`,
`interview-prep`, `new-hire-onboarding`, `systems-algorithms`, `well-structured-code`,
`rust-basics`. Concept steps are reading; unit steps are graded lessons showing real
progress. **A track never marks reading as "done"** — nothing was verified, so claiming
otherwise would be dishonest.

### 3.4 `buildquick learn` — lessons graded by real tests

```bash
buildquick learn                                     # what's available
buildquick learn algorithms 01-token-bucket          # read it, get a scratch file
buildquick learn algorithms 01-token-bucket --submit implement-token-bucket
buildquick learn --review                            # recall quiz, spaced 1→3→7→16→35→90 days
```

**Seven kinds of content:**
- **algorithms** (4 units) — token bucket, exponential backoff with jitter, LRU cache,
  consistent hashing. The algorithms that actually ship in backends, not interview
  puzzles.
- **refactoring** (2 units) — extract the domain, depend on an interface. The tests only
  pass if you genuinely split the code apart, because they import the extracted piece
  directly and call it with no HTTP request and no database.
- **rust** (3 units) — the language itself, cargo through ownership. Requires a Rust
  toolchain.
- **traps** (4 units) — the small things that break production: Unicode
  normalization and invisible characters, what "length" means, money in floats,
  64-bit IDs in JSON, NaN, rounding modes, `||` vs `??`, days that aren't 24 hours,
  Feb 29, `{...headers}`, path traversal. Predict the surprising output, then fix
  the bug; 35 matching concepts (`buildquick concepts nan-and-infinity`) cover the
  rest - SQL NULL logic, socket exhaustion, captive dependencies, SSRF, timing attacks.
- **regex** (3 units) — the small regex mistakes that become real bugs: missing
  anchors, unescaped `.`, greedy vs lazy, `|` precedence, the `g` flag's
  `lastIndex`, catastrophic backtracking (ReDoS). Patterns are graded against
  must-match and must-reject cases, and the feedback shows *what* matched inside
  an input it should have rejected. `buildquick regex '<pattern>' text...`
  highlights matches in any text and flags the classic pitfalls.
- **reading** (3 units) — reading and debugging AI-written code: *predict what this
  prints* (graded without running it; the answer key is verified by a test that runs
  every program) and *find the bug* (async traps, shared mutation, edge cases).
- **yaml** (3 units) — what the parser really builds from your file (`3.10` becomes
  `3.1`), what GitHub Actions does behind the scenes when you push, and cron schedules.
  Graded by what the YAML *means* once parsed, so any correct spelling passes, and
  a cron answer is checked against real dates rather than compared as text.
  `buildquick cron "<expr>"` prints the next run times of any schedule.

**How grading works.** JavaScript units run under `node --test`, which is built into
Node — so a challenge workspace needs **zero dependencies and no install**, and runs
offline. Rust units shell out to real `cargo check` / `cargo run` / `cargo clippy`.

Get consistent hashing wrong by reaching for `hash(key) % N` and the suite tells you
exactly why: *"expected well under 35% of keys to move, got 80.5%"* — the same 80% the
lesson's explanation predicted.

**Hidden tests are rewritten from source on every submit**, deliberately. They sit in
your own directory, so editing them to pass would otherwise be the path of least
resistance.

### 3.5 The loop these four form

```
buildquick check          →  "you have no rate limiting"
buildquick concepts rate-limiting  →  why that matters, and what it costs you
buildquick learn algorithms 01-token-bucket  →  now build one that passes real tests
```

That's the whole product thesis in three commands.

---

## 4. How the code is organized

```
src/
  cli.ts                  Command registration only (143 lines)
  postGenerate.ts         Everything printed after a scaffold

  stacks/                 Project generation
    StackAdapter.ts         The contract every stack implements
    springboot/             addons (prompts+validation), multiModule, singleModule,
                            layout (shared Java sources), types, templates/
    aspnetcore/adapter.ts   Thin wrapper around BuildQuickPkg

  check/                  Repo grading
    repo.ts                 Filesystem scan → RepoSnapshot (bounded: 2000 files max)
    operationalRules.ts     8 "will it survive traffic" rules (secrets, limits, outbound calls)
    databaseRules.ts        4 more: query shape, pooling, schema history
    literals.ts             Blanks strings/comments so code rules don't match text about code
    evidence.ts             Per-ecosystem library symbols proving a mechanism is wired
    structuralRules.ts      3 "can it be changed" rules
    rules.ts                Merges both, tags each with its kind
    runner.ts               Runs applicable rules, sorts by severity
    reportRender.ts         Pure string building — testable without capturing stdout
    reportGap.ts            "This finding is wrong" → local file + pre-filled mailto
    checkCommand.ts         CLI glue only (25 lines)

  concepts/               76 concepts in 7 themed files + index (trapsData.ts, trapsSystems.ts = the 35 small traps)
  learn/                  Lesson engine
    types.ts                Unit, Challenge, Checker interface
    loader.ts               YAML → validated units, fails loudly
    contentDir.ts           Custom content roots (BUILDQUICK_CONTENT / .buildquickrc)
    tracks.ts               Curriculum layer, validates every step resolves
    progress.ts             Per-challenge progress, spaced repetition
    workspace.ts            Scratch project per challenge
    checkers/               nodeChecker (node --test), rustChecker (cargo)

content/                  All lesson content as YAML data, never code
  algorithms/units/  refactoring/units/  rust/units/  tracks.yaml
```

**Largest source file is 319 lines** (`src/check/repo.ts`) — under the
500-line threshold the tool itself flags, so it passes its own `god-file` rule, but close
enough that it should be split before more rules are added to it. The per-ecosystem
evidence lists that rate limiting and health checks match against already live in their
own `evidence.ts` for that reason.

---

## 5. Design decisions worth knowing

**Content is data, not code.** Every lesson and track is YAML. Adding content never
touches the engine. This is what makes `BUILDQUICK_CONTENT` work — a team points it at
their own directory and ships their own standards, falling through to bundled content
for anything they don't provide.

**Language support is a plugin interface, not a fork.** Both `StackAdapter` (generation)
and `Checker` (grading) are interfaces. Adding a language means writing an adapter, not
modifying the engine.

**No AI, no network, no telemetry.** Deterministic checks, local execution, offline
lessons. Even the gap-reporting feature — which exists precisely so gaps get found —
opens your own mail client and sends nothing on its own. A tool that tells users to
judge its findings shouldn't quietly judge them in the background.

**Honest framing over impressive framing.** `LEVELING-UP.md` opens by saying none of its
content is in the generated code. Findings are labeled heuristics. Tracks don't mark
reading as completed. This is a deliberate trust position.

---

## 6. What exists vs. what doesn't

**Built and working:**
- Spring Boot scaffolding (3 structures, DB, JWT, Docker, tests, microservices)
- ASP.NET Core scaffolding via wrapper
- `check` with 15 rules across 13 of the 76 concepts. Rules that look for code
  (a call, a server, a DB client) ignore matches inside strings and comments, so
  analyzers, code generators and docs-heavy repos aren't graded on text about code.
  `{"kind": "cli"}` in a repo's `.buildquickrc` skips the production-service checks.
- 76 concepts (every one with a code example), 12 tracks, 22 lesson units, each
  with recall questions for `learn --review`
- Inline suppression: `// buildquick-ignore-next-line <rule>` or
  `buildquick-ignore-file <rule>`; every hidden finding is counted in the report
- Node and Rust graders, progress tracking, spaced repetition
- Custom content packs
- 177 tests, clean typecheck, clean build
- `LICENSE`, npm publish workflow, `prepublishOnly` verification

**Not built:**
- Rust scaffolding (the language is taught, but not generated)
- Concept lessons for the other 19 concepts
- Java/C# lesson graders
- Web UI
- **Not published to npm, and not yet used by anyone but its author**

---

## 7. Known limitations, stated plainly

These are real and unfixed. They're listed because a tool that hides its weak spots
loses trust faster than one that names them.

1. **`check` rules are text heuristics.** They can't parse code. False positives and
   false negatives are both possible. Several have already been found and fixed by
   running against real repositories — that process isn't finished.
2. **`env-not-ignored` only reads the root `.gitignore`.** A nested `.gitignore` in a
   monorepo subfolder would produce a false positive.
3. **Generic words weaken two rules.** `no-rate-limiting` matches "throttle" and
   `no-healthcheck` matches "ping" — an unrelated UI throttle utility or a websocket
   heartbeat could suppress a real finding. This leans toward false negatives, which is
   the intended failure direction, but it's imprecise.
4. **`query-in-loop` can't tell what's being iterated.** A loop over collection names is
   fine; a loop over rows isn't. The rule says so rather than pretending to know.
5. **Nothing stops someone AI-ing a lesson answer.** Hidden tests prevent test-tampering,
   not prompt-pasting. Every at-home exercise platform shares this.
6. **`too-many-dependencies` counts Python's `self`** as one of its threshold, making it
   marginally conservative for Python.
7. **Zero external validation.** No developer other than the author has used any of this.
   Every claim about whether it helps is a hypothesis.

---

## 8. Running it

```bash
npm install
npm run build
npm link          # makes `buildquick` available globally

buildquick --help
```

Verification: `npm run verify` (typecheck + tests). `COMMANDS.md` is a hands-on
walkthrough of every command with expected output and what to be suspicious of.

**Requirements:** Node 18+. Rust lessons need `rustup`. Spring Boot generation needs
nothing (the Maven Wrapper ships with every generated project). ASP.NET Core generation
needs `dotnet tool install --global BuildQuickPkg`.

---

## 9. Where it's headed

`ROADMAP.md` has the full research-backed version. The short form:

- **Nearest:** publish to npm, then get it in front of real backend engineers. Everything
  else is speculation until that happens.
- **Next:** concept lessons for the remaining 19 concepts — the engine is done, this is
  content work against a proven schema.
- **Then:** Java/C# graders so the tutor covers the same stacks the scaffolder does.
- **Deliberately not doing:** competing with Exercism on language breadth, CodeCrafters
  on "build your own Redis," Boot.dev on gamification, or becoming another AI PR
  reviewer. Each of those is a fight against an incumbent with no edge to bring.
