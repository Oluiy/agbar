# buildquick (Aggregator)

An interactive CLI that scaffolds a fully-wired, Clean-Architecture-shaped backend solution in seconds, regardless of which stack you use. Pick a stack, answer a few prompts, get a real project, not a single empty file.

```bash
npm install -g buildquick
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
| **Spring Boot** | Available | Native support: Maven multi-module Clean Architecture, Spring Data JPA (PostgreSQL/MySQL), Spring Security + JWT, Docker. |
| **Rust (Axum)** | Planned | Same adapter pattern, not yet built. |

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
