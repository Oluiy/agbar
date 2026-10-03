import type { FastApiDb, FastApiStructure } from "../types.js";

/**
 * Project-level files: dependencies, tooling config, and the docs.
 *
 * Dependencies are declared as lower bounds, never exact pins. A scaffold that
 * pins versions is stale the week after it is written - letting pip or uv resolve
 * at generate time is what keeps a generated project current without this file
 * needing to be maintained.
 */

function runtimeDeps(db: FastApiDb): string[] {
  // fastapi[standard] rather than fastapi + uvicorn: it brings FastAPI's own CLI
  // (`fastapi dev` / `fastapi run`) along with uvicorn and httptools. Using the
  // framework's own command is both less to remember and what its docs assume.
  const deps = ["fastapi[standard]>=0.115", "pydantic-settings>=2.4"];
  if (db !== "none") deps.push("sqlalchemy>=2.0", "alembic>=1.13");
  if (db === "postgres") deps.push("psycopg[binary]>=3.2");
  return deps;
}

// httpx2, not httpx: Starlette's TestClient now warns that pairing it with httpx 0.x
// is deprecated, and a generated project should not start life emitting a
// deprecation warning on every test run.
const DEV_DEPS = ["pytest>=8", "httpx2>=2", "ruff>=0.6"];

export function pyprojectToml(projectName: string, db: FastApiDb): string {
  const deps = runtimeDeps(db)
    .map((d) => `    "${d}",`)
    .join("\n");
  const devDeps = DEV_DEPS.map((d) => `    "${d}",`).join("\n");

  return `[project]
name = "${projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}"
version = "0.1.0"
description = "${projectName} - a FastAPI service"
requires-python = ">=3.11"
# Lower bounds, not pins: the resolver picks current versions at install time.
# Commit the lock file your tool produces (uv.lock / requirements.lock) to make
# builds reproducible - that is the right place for exact versions, not here.
dependencies = [
${deps}
]

[project.optional-dependencies]
dev = [
${devDeps}
]

[tool.pytest.ini_options]
# Without this, "from app.main import app" fails: pytest adds the test directory to
# sys.path, not the project root.
pythonpath = ["."]
testpaths = ["tests"]
addopts = "-q"

[tool.ruff]
line-length = 120
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "ASYNC"]
`;
}

export function requirementsTxt(db: FastApiDb): string {
  return `${runtimeDeps(db).join("\n")}\n`;
}

export function requirementsDevTxt(): string {
  return `-r requirements.txt\n${DEV_DEPS.join("\n")}\n`;
}

export function envExample(projectName: string, db: FastApiDb): string {
  const dbLine =
    db === "none"
      ? ""
      : db === "sqlite"
        ? `DATABASE_URL=sqlite:///./${projectName.toLowerCase()}.db\n`
        : `# Replace the password before using this anywhere real.
DATABASE_URL=postgresql+psycopg://postgres:CHANGE_ME@localhost:5432/${projectName.toLowerCase()}\n`;

  return `# Copy to .env and edit. .env is gitignored; this file is the documented shape.
APP_NAME=${projectName}
API_PREFIX=/api/v1
${dbLine}REQUEST_TIMEOUT_SECONDS=10
`;
}

export function gitignore(projectName: string, db: FastApiDb): string {
  const dbFile = db === "sqlite" ? `\n# Local database\n${projectName.toLowerCase()}.db\n*.db-journal\n` : "";
  return `# Secrets - the .env.example in this repo documents the shape instead.
.env
.env.*
!.env.example

# Python
__pycache__/
*.py[cod]
.venv/
venv/
*.egg-info/
.pytest_cache/
.ruff_cache/
.mypy_cache/
${dbFile}
# Editors / OS
.idea/
.vscode/
.DS_Store
`;
}

export function readmeMd(projectName: string, db: FastApiDb, structure: FastApiStructure): string {
  const dbSetup =
    db === "postgres"
      ? `
### Database

\`\`\`bash
docker compose up -d db          # starts PostgreSQL
cp .env.example .env             # then set a real DATABASE_URL password
alembic upgrade head             # apply migrations
\`\`\`
`
      : db === "sqlite"
        ? `
### Database

SQLite, so there is nothing to start. Apply migrations with \`alembic upgrade head\`.
`
        : "";

  return `# ${projectName}

A FastAPI service generated with [buildquick](https://github.com/Oluiy/aggregator)
using the **${structure}** structure. See [ARCHITECTURE.md](ARCHITECTURE.md) for why it
is shaped this way.

## Run it

\`\`\`bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt     # or: uv sync --extra dev
pytest                                  # the generated tests should pass
fastapi dev app/main.py                 # FastAPI's own CLI: reload + a nicer startup banner
\`\`\`

In production, \`fastapi run app/main.py\` (no reload, multiple workers) rather than
\`fastapi dev\`.

Then open <http://127.0.0.1:8000/api/v1/docs>.
${dbSetup}
## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | \`/health\` | Liveness. Unversioned, because probes point at a fixed path. |
| GET | \`/api/v1/health/ready\` | Readiness${db === "none" ? "" : " - actually queries the database"}. |
${
  db === "none"
    ? ""
    : `| POST | \`/api/v1/items\` | Create an item. |
| GET | \`/api/v1/items?limit=50&offset=0\` | List items, paginated and capped. |
| GET | \`/api/v1/items/{id}\` | Get one item, 404 when missing. |
`
}
## Tests

\`\`\`bash
pytest                  # all of them
pytest tests/unit       # no database, no HTTP - just the service
\`\`\`

The integration tests run against an in-memory SQLite database, so they pass on a
fresh clone with nothing installed or running besides the dependencies.

## Grade it

\`\`\`bash
buildquick check        # the same checker that generated this project
\`\`\`
`;
}

export function architectureMd(projectName: string, structure: FastApiStructure, db: FastApiDb): string {
  const layouts: Record<FastApiStructure, string> = {
    layered: `\`\`\`
app/
  api/            HTTP only: routers, status codes, dependency wiring
    routes/       one module per resource
    deps.py       the Annotated dependency aliases routes use
  services/       business rules; no SQL, no HTTP types
  repositories/   every query against a table, in one place
  models/         SQLAlchemy tables
  schemas/        Pydantic request/response shapes
  db/             engine, session factory, declarative Base
  core/           settings
tests/
\`\`\`

**Why:** split by technical role. It is the layout most Python developers already
read fluently, and the one with the least ceremony. The tradeoff is that one
feature's code is spread across five folders - fine until the project has many
features, at which point *modular* costs less.`,

    modular: `\`\`\`
app/
  modules/
    items/        router, service, repository, models, schemas - one feature
    health/       router
  core/           settings, shared deps, db/ (engine, session, Base)
  router.py       mounts every module's router
tests/
\`\`\`

**Why:** split by domain concept. Everything about items is in one folder, so a
feature can be read, reviewed, moved or deleted as a unit, and two people working
on different features rarely touch the same file. The tradeoff is that "where do
all the queries live?" no longer has a single answer.`,

    clean: `\`\`\`
app/
  domain/           the rules and the vocabulary; imports nothing outward
    item.py         a plain dataclass - no SQLAlchemy, no Pydantic
    repositories.py the ItemRepository Protocol the domain requires
  application/      services that orchestrate the domain
  infrastructure/
    db/             SQLAlchemy models, session, and the repository implementation
  api/              FastAPI routers, schemas, dependency wiring
tests/
\`\`\`

**Why:** dependencies point inward only. The domain declares the interface it
needs and infrastructure implements it, so the database can be swapped, and the
business rules can be tested with a dict instead of a database. The tradeoff is
real: an entity *and* a table model *and* a mapping between them, which is
ceremony that only pays off when the rules are complex or long-lived.`,
  };

  return `# Architecture

${projectName}, generated with buildquick. This file records the decisions so the next
person does not have to reverse-engineer them.

## Structure: ${structure}

${layouts[structure]}

## The rule that matters

**Dependencies point one way: HTTP -> service -> repository -> database.**

A route may call a service. A service may call a repository. Nothing calls back
outward. Concretely:

- \`HTTPException\` appears only in \`api/\`. The service raises \`ItemNotFoundError\`,
  a plain Python exception, so the same service could back a CLI or a queue consumer.
- SQL appears only in the repository. "Is this query indexed?" is answerable by
  reading one file.
- Pydantic schemas are the edge contract. The response model is declared separately
  from the table model, so adding an internal column never leaks it to clients.

## Decisions already made for you

| Decision | Why |
|---|---|
| **Listing is paginated by default** (\`limit\`, \`offset\`, capped at 200) | An unbounded \`SELECT *\` is fine at 200 rows and a timeout at 2 million. The cap is in the route signature, so no later edit can remove it by accident. |
| **Liveness and readiness are separate** | Liveness at \`/health\` answers "am I running?". Readiness at \`/api/v1/health/ready\`${db === "none" ? "" : " queries the database and returns 503 when it cannot"}, because a process that is up but cannot reach its database should be pulled from the load balancer, not sent traffic. |
| **Config is typed** (\`pydantic-settings\`) | A malformed value fails at startup with a clear message instead of surfacing as a confusing error on the first request. |
| **No credentials in source** | \`DATABASE_URL\` comes from the environment; \`.env\` is gitignored and \`.env.example\` documents the shape. |
| **Dependencies are lower bounds, not pins** | The resolver picks current versions at install time. Commit the lock file for reproducibility - that is where exact versions belong. |
${db === "none" ? "" : "| **Alembic owns the schema** | `create_all` runs only so a fresh clone works; every real change is a reviewable migration file with an ordered history. |\n"}| **A request gets one session, always closed** | \`get_session\` yields, so FastAPI tears it down after the response - and a test can override that one function. |

## Where to add things

| You want to... | Do this |
|---|---|
| Add an endpoint | ${structure === "modular" ? "Add a folder under `app/modules/`, then one line in `app/router.py`." : "Add a module under `app/api/routes/`, then one line in `app/api/router.py`."} |
| Change the schema | \`alembic revision --autogenerate -m "what changed"\`, read the generated file, then \`alembic upgrade head\`. |
| Call another service | Build the HTTP client with \`settings.request_timeout_seconds\`. A client with no timeout lets one slow dependency hold a worker open indefinitely. |
| Add background work | Keep it out of the request path. FastAPI's \`BackgroundTasks\` is for short work; anything retryable belongs in a real queue. |

## What this scaffold deliberately does not include

Rate limiting, authentication, caching and tracing. Each is a real decision that
depends on your deployment, and a wrong default is worse than an obvious gap.
Run \`buildquick check\` on this project to see them listed as findings, with the
reasoning for each.
`;
}
