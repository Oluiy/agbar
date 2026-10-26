# Changelog

All notable changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to follow
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-05

First public release.

### Added

- **`buildquick check`**: grades a repo against 16 rules for production problems - leaked
  secrets, missing timeouts, N+1 queries, unbounded list queries, no rate limiting, no
  health check, no migrations, oversized files, and more. Each finding has a severity, a
  file and line, a next step, and a link to a concept.
- **Stack-aware advice**: next steps are written for the language of the flagged file
  (.NET, Go, Rust, TypeScript, JavaScript, Java, Python).
- **`buildquick concepts`**: 76 concepts - the failure scenario, the fix, a code example -
  searchable by id or keyword.
- **`buildquick learn`, `tracks`, `submit`**: graded lessons where you write real code or
  YAML and get specific feedback, plus 12 ordered learning tracks and a spaced-repetition
  review (`learn --review`).
- **`buildquick regex` and `buildquick cron`**: see what a regex matches and where it
  breaks, and exactly when a cron schedule will run.
- **Scaffolding** of FastAPI, Django, Axum (Rust), Spring Boot, NestJS, Express, Fastify, AdonisJS and ASP.NET Core
  projects, each with an `ARCHITECTURE.md`. FastAPI, Django and Axum offer two or three
  architectures and SQLite or PostgreSQL, ship a paginated example feature, split
  liveness/readiness probes, rate limiting, and migrations, and can install and run
  their own tests right after generating. Dependency versions are resolved by the
  ecosystem's tooling (`cargo add`, Spring Initializr, `nest new`, pip) rather than
  pinned, so a generated project is not stale on arrival. NestJS 12 needs Node 22.22.3+
  (its own requirement). Express and Fastify offer Prisma 7, Drizzle, TypeORM and
  Sequelize 6 through one plug-in interface. AdonisJS is built on its official starter kit
  and needs Node 24 and network access. The Express, Fastify and NestJS Dockerfiles were
  built and run end to end (they use `node:24-trixie-slim`: prebuilt native modules refuse
  to load on bookworm's older glibc). The Spring Boot, Django, FastAPI and Axum Dockerfiles
  have not been built.
- **`.buildquickrc`**: `{"kind": "cli"}` skips advice meant for production services, and
  inline suppressions silence a rule on a line.
- **One colour palette** across all commands, with colour never the only signal.
- **Scaffolding is fast by default.** Generating is about half a second; installing
  dependencies is minutes, so "install and run the tests now?" defaults to No and the exact
  commands to finish by hand are printed instead. Answer Yes and installing runs as its own
  phase, with named steps and an elapsed clock (`uv` is used when present, and pip says so).
- **Ctrl-C does what it says.** Cancelling before generation finishes leaves nothing behind;
  cancelling during the install keeps the project and says how to finish (exit code 130); a
  second Ctrl-C quits immediately. A destination that already holds files is refused rather
  than merged into.
- **Only the questions a stack uses are asked**, with a "use the recommended defaults"
  shortcut that names what it picks. Flags a stack ignores (`--port`, `--microservice`,
  `--services`, `--jwt`, `--four-layer`, `--three-layer`) are refused with a clear message
  instead of being silently dropped.
- **`--db` and `--orm` work on every stack** (previously `--db` only reached Spring Boot),
  and the Express/Fastify ORM menu offers every ORM that can be generated - Prisma, Drizzle,
  TypeORM and Sequelize - rather than only Prisma.

### Security

- `check` masks secret values in its output (URL passwords, `Password=`/`pwd=`/`token`
  style assignments, AWS access key ids). Findings show `file:line` and a redacted line,
  never the secret.

### Fixed

- `check` skipped every database rule on Django, Peewee, Tortoise and SQLModel projects:
  their database is implicit (SQLite needs no driver), so no database dependency was
  ever listed. Found by grading buildquick's own generated Django project.
- `check` never ran its HTTP rules (rate limiting, health check) on AdonisJS apps, and
  did not count `drizzle-kit` or `umzug` as migration tools. Both found by grading
  buildquick's own generated projects.
- Non-interactive `--config` now rejects unknown keys by name and supports
  `outputDirectory`; both used to be ignored silently.

### Quality

- Precision is measured, not assumed, on open-source repos the rules had never seen: 84%
  on a first batch of nine (27 of 32 findings correct) and 89% on a second batch of ten
  (24 of 27), before fixing. Every false positive was fixed with a regression test that also
  proves the rule still catches the real case, and both batches now guard against
  regressions in a 37-repo corpus.
- Generated projects are verified by running them, not by reading templates: CI generates
  12 real projects, then installs, typechecks, tests, builds, builds the Docker image and
  hits `/health`. Template version pins are kept current by Renovate.
- 642 tests; typecheck, lint and tests run on Node 20, 22 and 24 for every change, and the
  published CLI is smoke-tested on Node 18.
