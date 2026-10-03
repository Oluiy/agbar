# buildquick (Aggregator)

An interactive CLI that scaffolds a fully-wired, Clean-Architecture-shaped backend solution in seconds, regardless of which stack you use. Pick a stack, answer a few prompts, get a real project, not a single empty file.

> **Not on npm yet.** `buildquick` hasn't been published to the registry —
> `npm install -g buildquick` will 404. Run it from a clone until the first
> release lands.

```bash
git clone https://github.com/Oluiy/aggregator.git
cd aggregator
npm install && npm run build
npm link          # puts `buildquick` on your PATH
buildquick
```

## Why

`dotnet new`, Spring Initializr, `django-admin startproject`, and friends each hand you a single empty project. None of them wire up Clean Architecture's layers, a database, JWT auth, or Docker for you. Every team ends up rebuilding the same boilerplate by hand, in every language, over and over.

`buildquick` picks up where those tools stop: choose your stack, your project structure, monolith or microservice, and the optional add-ons you want (database, JWT, Docker, tests) - and get a solution that actually builds and runs immediately.

Project structure is a real interactive choice, not one fixed opinion: **Multi-Module** (Clean Architecture enforced via separate Maven modules - the more rigorous option, best for larger teams), **Package-by-Layer** (a single module, `controller`/`service`/`repository`/`model` packages - the convention most tutorials teach and most real Spring Boot projects converge on by hand; Spring Initializr itself only generates a bare `@SpringBootApplication` class with no structure at all, so this is what you'd normally build yourself, not something Initializr does for you), or **Package-by-Feature** (a single module organized by domain concept instead of technical layer, the pattern gaining the most traction for modern apps). Package-by-Layer is the actual default; the other two are legitimate, deliberate alternatives, not "more standard" or "less standard" than it - just different tradeoffs.

## Supported stacks

| Stack | Status | Notes |
| --- | --- | --- |
| **ASP.NET Core** | Available | Thin wrapper around [BuildQuickPkg](https://github.com/Oluiy/build-quick-aspnet), the dedicated .NET tool this project grew out of. Requires `dotnet tool install --global BuildQuickPkg`. |
| **Spring Boot** | Available | Maven multi-module Clean Architecture, Package-by-Layer or -by-Feature, Spring Data JPA (PostgreSQL/MySQL), Spring Security + JWT, Docker. Builds with [Spring Initializr](https://start.spring.io) when online, so the Boot version is Spring's current release; falls back to its own template offline. |
| **FastAPI** | Available | Python. Layered, modular-by-feature or clean architecture; SQLAlchemy 2 + Alembic on SQLite or PostgreSQL; `fastapi dev`/`run`; pytest. Tested end to end on every structure. |
| **Django** | Available | Python. Standard or service-layer (`services.py`/`selectors.py`) structure; Django REST Framework; SQLite or PostgreSQL; Django's own test runner. Tested on Django 5.2 (Python 3.11) and 6.1 (Python 3.13). |
| **NestJS 12** | Available | TypeScript. Modular or clean structure; Prisma 7 on SQLite or PostgreSQL; global rate limiting. **Needs Node 22.22.3+, 24.15+ or 26+** (NestJS 12's own requirement; the generated `engines` field says so). Verified: install, `tsc`, unit tests, 8 HTTP e2e tests against a real SQLite database, `nest build`, and a live server, on Node 24. The e2e suite uses its own database (`TEST_DATABASE_URL`) and never resets your `DATABASE_URL`. |
| **Express 5** | Available | TypeScript, ES modules. Layered or clean structure; Prisma 7 on SQLite or PostgreSQL (or no ORM); zod validation, helmet, per-client rate limiting, graceful shutdown; vitest + supertest. ORM: **Prisma 7, Drizzle, TypeORM or Sequelize 6** (or none), each behind one small `Database` interface so the routes, service and tests never name the ORM. Verified per ORM: install, typecheck, 20 tests, build, and the real server against a real SQLite database (including a 429 from the rate limiter); PostgreSQL variants typecheck and pass their unit/HTTP tests (repository tests need a live server). Needs Node 22.12+. |
| **Fastify 5** | Available | Same as Express, on Fastify (`@fastify/helmet`, `@fastify/rate-limit`, `app.inject()` tests), with the same four ORMs. Verified the same way. |
| **AdonisJS 7** | Available | Built **on the official `api` starter kit** (`npm create adonisjs -- --kit=api`), plus `@adonisjs/limiter` via `node ace add`; buildquick overlays an items feature (Lucid, VineJS), health probes and Japa tests. Verified: typecheck, 7 tests, and a live server. Needs Node 24+ and network access (there is no offline fallback). SQLite only. |
| **Rust (Axum)** | Available | Layered or clean structure; sqlx on SQLite or PostgreSQL; per-client rate limiting, timeouts, graceful shutdown. Built with `cargo new` + `cargo add`, so versions are always current. The PostgreSQL HTTP tests are `#[ignore]`d until you set `TEST_DATABASE_URL`. `buildquick learn rust` (below) teaches the language itself, separately. |

The FastAPI, Django, Axum, NestJS, Express, Fastify and AdonisJS adapters can install and run the generated project's own tests right after generating (`install`), and report whether they passed. Spring Boot and ASP.NET Core don't have that step.

**Docker:** the Express (Prisma), Fastify (Sequelize) and NestJS (Prisma) Dockerfiles were each built and run, and the container answered `/health` as a non-root user. The other ORM/database combinations share the same Dockerfile shape but were not individually built; `.github/workflows/scaffold-verify.yml` builds and runs six of them on every change. The Spring Boot, Django, FastAPI and Axum Dockerfiles have not been built.

Each stack is a self-contained `StackAdapter` (see `src/stacks/StackAdapter.ts`) - the interactive engine (`src/engine.ts`, `src/prompts.ts`) knows nothing about C#, Java, or Rust specifically. Adding a new stack means writing a new adapter, not touching the engine.

## What you get (Spring Boot example)

Multi-Module structure, 4-layer:

```
MyAwesomeApi/
├── mvnw, mvnw.cmd, .mvn/        # Maven Wrapper - builds even with no Maven installed
├── pom.xml                      # aggregator POM (Maven reactor)
├── myawesomeapi-domain/         # entities, pure business rules
├── myawesomeapi-application/    # services (interface + impl pairs)
├── myawesomeapi-infrastructure/ # JPA repositories, DataSource config (4-layer only)
├── myawesomeapi-api/            # controllers, Spring Security, @SpringBootApplication
├── Dockerfile                   # if Docker was selected
└── docker-compose.yml
```

Package-by-Feature structure (single module) instead puts everything for one concern together regardless of technical role - `health/HealthController.java` + `HealthService.java` + `HealthServiceImpl.java` in one package, `auth/` the same way when JWT is selected, including the Spring Security filter chain.

- Multi-Module (3-layer or 4-layer), Package-by-Layer, or Package-by-Feature - see "Project structure" above
- Monolith or microservice (one full project per named service, plus a reactor root for one-shot builds)
- Optional PostgreSQL or MySQL via Spring Data JPA, with `application.yml`/`application-dev.yml`/`application-prod.yml` layering
- Optional JWT authentication: a working token-issuing endpoint and a protected sample endpoint, wired through Spring Security
- Optional Docker: multi-stage `Dockerfile` + `docker-compose.yml`, with a database service included automatically when a provider is selected
- A JUnit smoke test for the health endpoint (using Spring Boot 4's `RestTestClient`, an in-memory H2 database, and a throwaway JWT key when needed - never a real database server or secret), when tests are included
- The Maven Wrapper, every time - a generated project builds with `./mvnw` alone, no Maven installation required

## ARCHITECTURE.md - why it's shaped this way, not just what got built

Every generated project also gets an `ARCHITECTURE.md`, written by `buildquick` itself, tying each structural choice you actually made to the engineering principle behind it - referencing the real classes that were written, not a generic textbook example. Picking Multi-Module gets an explanation of how Maven physically enforces the Dependency Inversion Principle at compile time; adding JWT gets an explanation of why token-issuing and token-verification are deliberately two different classes (Single Responsibility Principle); every project gets a note on why `application.yml` has two thin environment overlays instead of two full copies of itself (DRY).

The point isn't the scaffolding speed - it's that code from a tool (or an AI) shouldn't be a black box you copy-paste and never understand. Skip it with `--no-explain` if you don't want the file.

```markdown
## Layers are separate Maven modules, not just folders

**Principle:** Dependency Inversion Principle (DIP), enforced at compile time

Multi-Module structure makes the domain -> application -> infrastructure -> api
dependency direction physical, not just a convention. Each layer's pom.xml only
lists the modules it's allowed to depend on... Try to import an infrastructure
class from domain and the project won't compile.
```

See `src/explain.ts` for the full, addon-driven list of callouts - same data-driven shape as `src/recommendations.ts` below, filtered by what was actually selected instead of shown unconditionally.

## LEVELING-UP.md - the things tutorials skip

Alongside `ARCHITECTURE.md`, every generated project also gets a `LEVELING-UP.md` - a fixed list of thirty-two reliability, security, operations, and design concepts that separate a tutorial CRUD API from a system that survives production: idempotency keys, database indexing, caching, message queues, retry mechanisms with exponential backoff, dead letter queues, circuit breakers, reconciliation, the CAP theorem, statelessness, connection pooling, security by design, observability, API versioning, communication patterns, choosing the right data store, rate limiting, database replication, secrets management, pagination, the N+1 query problem, distributed locks, optimistic/pessimistic concurrency control, backpressure, the bulkhead pattern, why backups aren't replication, multi-tenancy data isolation, and the structural set (dependency inversion, single responsibility, separation of concerns, coupling and cohesion, DRY).

This one is deliberately honest about what it isn't: none of these thirty-two things are actually in the code `buildquick` just generated - it doesn't scaffold a message queue or a circuit breaker. Each entry pairs a concrete failure scenario ("a user's withdrawal times out and they click the button three times") with the mechanism that prevents it, so it reads as "here's what you'll need before you need it," not as documentation for code you were just handed. Same `--no-explain` flag skips this file too. See `src/concepts.ts` for the full list.

## `buildquick concepts` - the same glossary, without scaffolding a project

`ARCHITECTURE.md` and `LEVELING-UP.md` only exist the moment a project gets generated, but the decisions they cover come up constantly afterward - while writing the actual business logic, days or months later. `buildquick concepts` makes that same content available on demand, with no project required:

```bash
buildquick concepts                  # list all 40, grouped by category
buildquick concepts rate limiting    # full explanation for one - matches by id or title substring
```

The point is proximity: looking something up without leaving the terminal you're already in, instead of a tab-switch to a blog post. `buildquick --help` points here too.

## `buildquick learn rust` - interactive lessons with real pass/fail checks

Everything above teaches backend *principles*. This teaches the Rust *language itself*, in bite-sized units loosely mapped to the structure of *The Rust Programming Language* (all explanations are original wording - no book text is reproduced), each with a runnable challenge checked by the real `cargo` toolchain, not a string comparison against your source code:

```bash
buildquick learn rust                                          # list units and your progress
buildquick learn rust 04-ownership-basics                      # explanation, example, and a scratch cargo project per challenge
buildquick learn rust 04-ownership-basics --submit fix-move-error  # runs cargo check/run for real, prints a hint on failure
buildquick learn rust --status                                 # progress table
```

Standalone by design - it works without ever scaffolding a project, and teaches the language rather than the Axum scaffold above. Progress and scratch workspaces live under `~/.buildquick/learn/`, never inside a real project. Ships with 3 units today (Getting Started, Common Concepts, Ownership - the flagship, given the most weight); the remaining book chapters are a content-only addition later, since the engine (`src/learn/`) doesn't change to add them.

## `buildquick check` - grade a repo you didn't write

In 2026 most code in a repo was generated or heavily assisted by an AI, and the person shipping it often can't explain all of it. `check` grades an existing repo against the same concepts, and every finding links to the explanation:

```bash
buildquick check              # grade the current directory
buildquick check ./api        # or any path
buildquick check --explain    # include the fix for each concept inline
```

```
4/5 checks passed  (3 not applicable)

MEDIUM No rate limiting found on an HTTP service - one misbehaving client or a
       credential-stuffing bot can take it down.
       Learn why: buildquick concepts rate-limiting
```

Two rules this holds itself to. **Every finding must link to a concept** - a finding with nothing to teach is just a lint rule, and there are better linters. (A schema-migrations check is deliberately absent for exactly this reason: no concept covers it yet.) And **these are text heuristics, reported as heuristics** - rules skip themselves when they can't apply, ignore test code, and stay quiet rather than guess. It's deliberately not supply-chain scanning: pair it with [OpenSSF Scorecard](https://scorecard.dev/), which does that well and free.

## `buildquick learn refactoring` - structure, graded by behaviour

The goal isn't code that merely runs. It's code you can still change in six months without asking an AI to rewrite the whole file because you can't find the one rule you came to edit.

```bash
buildquick learn refactoring 01-extract-the-domain
buildquick learn refactoring 01-extract-the-domain --submit extract-pure-function
```

These are refactoring exercises, and the trick is that **the tests can only pass if you actually pulled the code apart** - they import the extracted function directly and call it with no request, no response, and no database. Leave the pricing rules inside the handler and there's nothing to import. Keep `new PostgresUserStore()` inside the constructor and the suite fails with `needs a real database`, because it tried to hand you a fake and you ignored it.

Five structural concepts back them up: `separation-of-concerns`, `dependency-inversion`, `single-responsibility`, `coupling-and-cohesion`, and `dry-principle` (including when *not* to apply it - a wrong abstraction costs more than duplication). The `well-structured-code` track walks them in order.

`check` grades the same properties on code you already have: a handler opening a database connection, a 600-line file, a constructor taking 8 dependencies.

## `buildquick learn algorithms` - the algorithms that actually ship

Not interview puzzles. The algorithms behind the concepts: token bucket (rate limiting), exponential backoff with jitter (retries), LRU (caching), consistent hashing (sharding - the thing Redis Cluster, Cassandra, DynamoDB and Kafka all use).

```bash
buildquick learn algorithms                                        # list units
buildquick learn algorithms 01-token-bucket                        # read, then edit the scratch file it points at
buildquick learn algorithms 01-token-bucket --submit implement-token-bucket
```

Graded by **real tests, not an AI judging your explanation** - `node --test`, which is built into Node, so a challenge needs zero dependencies and runs offline. Get consistent hashing wrong by reaching for `hash(key) % N` and the suite tells you exactly why: *"expected well under 35% of keys to move, got 80.5%"* - the same 80% the lesson warned about.

The tests are rewritten from source on every submit, deliberately: they sit in your own directory, so editing them to pass would otherwise be the path of least resistance.

This closes the loop the rest of the tool opens - `check` finds you have no rate limiting, `concepts rate-limiting` explains why it matters, and this makes you build one that works. The `systems-algorithms` track walks all four in that order.

## `buildquick learn yaml` - GitHub Actions, cron, and what YAML really means

Most people copy workflow files without knowing what the parser builds from them. Three units fix that: what YAML turns your text into (`python-version: 3.10` asks for Python **3.1**), what GitHub does behind the scenes when you push (fresh machine per job, new shell per `run:`, `${{ }}` evaluated before the shell sees it), and cron schedules (UTC, best-effort timing, runs that silently stop after 60 days).

```bash
buildquick learn yaml 03-cron-schedules                            # read, then edit the solution.yml it points at
buildquick learn yaml 03-cron-schedules --submit weekday-standup
buildquick cron "30 9 * * 1-5"                                     # the next runs, in UTC and your local time
```

Graded by what the file **means** once parsed, not how it's spelled - `30 9 * * 1-5` and `30 9 * * MON-FRI` both pass, because the grader checks the schedule against real dates. Each mistake gets its own feedback: *"'30 9 * * *' fires at 2026-09-26T09:30:00Z (UTC), but shouldn't"* - that's a Saturday. Parse errors are translated too: an unquoted `*/5 * * * *` is explained as a YAML alias, not reported as `UNEXPECTED_TOKEN`.

## `buildquick tracks` - ordered paths, not a pile of topics

27 concepts and a lesson library are only useful if you know what order to take them in. Tracks are ordered paths through both, grouped by who's walking them:

```bash
buildquick tracks                       # list all tracks
buildquick tracks production-readiness  # open one (matches by id or substring)
```

Ships with five: `student-backend`, `production-readiness` (DevOps/SRE), `interview-prep`, `new-hire-onboarding` (what a senior hands a junior in week one), and `rust-basics`. Concept steps are reference reading; unit steps are graded lessons and show your real progress - a track never reports reading as "done," because nothing was verified.

Scaffolding a project points you at the right one automatically. Generate something with a database, Docker, and JWT and it ends with the production-readiness track plus the specific concepts your choices just made relevant (`security-by-design` because you enabled JWT, `pagination` and `n-plus-one-queries` because you added a database) - not a generic reading list. `--no-explain` skips this along with the rest of the teaching output.

## Bring your own content

Teams can ship their own lessons and tracks without forking anything - content is YAML data, not code:

```bash
export BUILDQUICK_CONTENT=./engineering-standards   # or: {"contentDir": "..."} in .buildquickrc
```

Resolution falls through to the bundled content for anything your directory doesn't provide, so you can ship one track or a single unit encoding your team's standards and still get everything else. A custom directory can also add a language buildquick doesn't bundle, or replace a bundled one outright.

## Spaced repetition

Passing a challenge once isn't the same as retaining it:

```bash
buildquick learn rust --review      # units you passed over 30 days ago
buildquick learn rust --review 90   # your own cutoff
```

## Recommended tooling, tied to what you actually built

After generation, `buildquick` prints tool recommendations keyed to your real choices, not generic advice - selecting a database recommends [`db-guard`](https://github.com/Oluiy/agnostic-db-guard) (verifies your backups actually restore, not just that the file exists) and [Testcontainers](https://testcontainers.com/) when tests are also included; saying yes to "will this call an LLM API" recommends [`ai-cost-guard`](https://github.com/Oluiy/ai-cost-guard) (a drop-in proxy that stops runaway LLM bills via per-user budgets and caching); Docker recommends [Trivy](https://trivy.dev/) for image scanning; every project gets the right dependency-vulnerability check for its stack (OWASP Dependency-Check for Java, the .NET SDK's own built-in `dotnet list package --vulnerable` for ASP.NET Core).

Every recommendation is tagged by tier - **Essential** (do this day one, any team size), **Before you ship** (once real users depend on this), **At scale** (only bites past one instance) - so the guidance scales with the project instead of dumping everything at once. See `src/recommendations.ts` for the full, data-driven list; every entry there was verified as a real, currently-maintained tool before being added, not assumed.

## Non-interactive mode (CI, scripting)

Every prompt has a flag equivalent, so `buildquick` can run with zero prompts - useful in CI, or for generating many projects from a script:

```bash
buildquick MyApi --yes --stack springboot --structure package-by-layer --db postgres --jwt --docker
```

`--yes` (or just passing `--config`) switches to non-interactive mode. Anything not explicitly set falls back to the same defaults the interactive prompts use (Package-by-Layer, no database, no JWT, tests included, port 8080). Invalid input fails loudly with a specific error and a non-zero exit code, rather than silently generating something nobody asked for - a scripted run should never succeed at the wrong thing quietly.

For more complex setups, point at a JSON file instead (flags still override matching values from it):

```bash
buildquick MyApi --config ./buildquick.config.json
```

```json
{
  "stack": "springboot",
  "isMicroservice": true,
  "serviceNames": ["Orders", "Payments"],
  "includeTests": true,
  "httpPort": 8080,
  "usesLlmApi": false,
  "addons": {
    "structure": "multi-module",
    "isFourLayer": true,
    "dbProvider": "postgres",
    "includeJwt": true,
    "includeDocker": true
  }
}
```

Run `buildquick --help` for the full flag list. The `addons` shape is stack-specific (Spring Boot's is shown above) - each adapter validates its own `addons` via `resolveAddons()` and rejects anything it doesn't recognize.

**Known gap:** the ASP.NET Core adapter can't run non-interactively yet - it hands off entirely to BuildQuickPkg's own interactive prompts, which have no flag surface of their own to drive non-interactively. `--yes --stack aspnetcore` refuses cleanly with an explanation rather than hanging. Fixing this requires BuildQuickPkg itself to gain non-interactive flags first.

## Development

```bash
npm install
npm run build       # tsup -> dist/cli.js
npm link            # test the `buildquick` command locally
npm test            # vitest - unit tests + generated-file-tree snapshots
```

Tests cover name validation, the recommendation engine's trigger logic, non-interactive config resolution (flag/config-file merging, precedence, every validation error path), and Spring Boot generation itself - a snapshot of the exact file tree for five representative structure/database/JWT/microservice combinations, plus targeted content assertions (e.g. Package-by-Layer never emits a `<modules>` POM, JWT off means zero security-related files get written). These are fast, offline, and don't need Maven or network access; they catch template regressions in the file *shape*, not whether the output actually compiles - `mvn compile` against a real generated project is still the right check before trusting a change works end to end.

No runtime templating engine (no Handlebars/EJS) - every generated file is a plain TypeScript function returning a template literal, the same philosophy [BuildQuickPkg](https://github.com/Oluiy/build-quick-aspnet) uses for its C# templates: generation logic stays type-checked, debuggable, and dependency-free.

## License

MIT
