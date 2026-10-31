# agbar

**Could you defend this code in a review? Find out in one command - and learn why.**

`agbar check` grades a backend repo for the problems that break in production - leaked secrets, missing timeouts, N+1 queries, no rate limiting - and links every finding to a short lesson. `check` and the lessons run entirely on your machine: no AI, no network, no telemetry. (Scaffolding is the exception - it downloads through your package manager and Spring Initializr.)

```bash
npm install -g agbar
cd your-project
agbar check
```

```text
11/15 checks passed  (4 not applicable)
4 medium

Will this survive traffic?

...

3.  MEDIUM  A query fetches every row with no limit. Fine at 200 rows, a timeout at 2 million.
        where: src/app.js:6  const rows = await pool.query("SELECT * FROM articles");
        Next: Add a LIMIT/cursor to the query flagged above and a default page size in the handler - don't wait for the table to grow to find out where the response times out.
        Learn why: agbar concepts pagination

...
```

Every finding gives you a severity, the exact file and line, the fix, and the command to learn why it matters. Works on .NET, Go, Rust, TypeScript, JavaScript, Java and Python projects.

## Then learn it

```bash
agbar concepts pagination      # why the finding matters, with a code example
agbar tracks first-steps       # a guided path for beginners - start here
agbar learn yaml 1             # graded lessons: write real code, get specific feedback
agbar cron "30 9 * * 1-5"      # see exactly when a schedule will run
agbar regex '^\d{5}$' 12345 123456   # see what a regex matches, and its pitfalls
```

## Why it's different from a linter

- **Every finding links to a lesson**: the failure scenario, the fix, a code example, and an exercise to practise it.
- **Graded lessons**: you write real code or YAML and get feedback like *"fires on Saturday, but shouldn't"*. Offline, nothing else to install.
- **Honest about its limits**: findings are labelled as heuristics, and `{"kind": "cli"}` in `.agbarrc` skips advice meant for production services.
- **Also scaffolds**: run `agbar` with no arguments to start a FastAPI, Django, Axum, Spring Boot, NestJS, Express, Fastify, AdonisJS or ASP.NET Core project. It builds with the framework's own tooling (`cargo add`, Spring Initializr, `nest new`), can install and run the new project's tests for you, and writes an `ARCHITECTURE.md` explaining why it's shaped that way.

## Works with Idari

[Idari](https://github.com/Oluiy/Idari) tells you *what your code is and what changed*; agbar tells you *whether it's any good*. After an AI session: `idari changes` to see what happened, `agbar check` to see whether it's sound, then follow the links to learn why.

## Learn more

[CONTRIBUTING.md](CONTRIBUTING.md) · [CHANGELOG.md](CHANGELOG.md) · [SECURITY.md](SECURITY.md) · [LICENSE](LICENSE) (MIT)
