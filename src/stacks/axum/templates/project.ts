import { toKebab, toSnake } from "../layout.js";
import type { AxumDb, AxumStructure } from "../types.js";

export function envExample(projectName: string, db: AxumDb): string {
  const url =
    db === "sqlite"
      ? `DATABASE_URL=sqlite://${toSnake(projectName)}.db?mode=rwc\n`
      : `# Replace the password before using this anywhere real.
DATABASE_URL=postgres://postgres:CHANGE_ME@localhost:5432/${toSnake(projectName)}
# For \`cargo test -- --ignored\` (the PostgreSQL integration tests):
TEST_DATABASE_URL=postgres://postgres:CHANGE_ME@localhost:5432/${toSnake(projectName)}_test
`;

  return `# Copy to .env and edit. .env is gitignored; this file documents the shape.
# Note: the server reads real environment variables - load .env with your shell,
# direnv, or docker compose; it is not read by the binary itself.
PORT=3000
${url}REQUEST_TIMEOUT_SECS=10
MAX_BODY_BYTES=1048576
RATE_LIMIT_PER_SECOND=10
RATE_LIMIT_BURST=50
RUST_LOG=info
`;
}

export function gitignore(projectName: string, db: AxumDb): string {
  const dbFile = db === "sqlite" ? `\n# Local database\n${toSnake(projectName)}.db\n*.db-shm\n*.db-wal\n` : "";
  return `# Build output
/target

# Secrets - .env.example documents the shape instead.
.env
.env.*
!.env.example
${dbFile}
# Editors / OS
.idea/
.vscode/
.DS_Store
`;
}

export function dockerfile(projectName: string): string {
  const bin = toKebab(projectName);
  return `# Two stages: the toolchain is large and none of it belongs in the image you ship.
FROM rust:1-slim-bookworm AS builder

WORKDIR /app
COPY . .
# Build here, not on the host: the binary must link against this image's libc.
RUN cargo build --release

FROM debian:bookworm-slim AS runtime

# curl for the health check; ca-certificates for any outbound TLS.
RUN apt-get update \\
    && apt-get install -y --no-install-recommends ca-certificates curl \\
    && rm -rf /var/lib/apt/lists/*

# Never root: a compromised container should not also be privileged.
RUN useradd --create-home --uid 10001 appuser
WORKDIR /app
COPY --from=builder /app/target/release/${bin} /usr/local/bin/app
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \\
    CMD curl -fsS http://127.0.0.1:3000/health || exit 1

# Migrations are embedded in the binary and applied at startup, so no extra files ship.
CMD ["app"]
`;
}

export function dockerCompose(projectName: string, db: AxumDb): string {
  const name = toSnake(projectName);
  if (db !== "postgres") {
    return `services:
  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: sqlite:///data/${name}.db?mode=rwc
    volumes:
      - data:/data
    restart: unless-stopped

volumes:
  data:
`;
  }

  return `services:
  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      # Inside the compose network the host is the service name, not localhost.
      DATABASE_URL: postgres://postgres:\${POSTGRES_PASSWORD:-postgres}@db:5432/${name}
    depends_on:
      db:
        # Not just "started": the API would otherwise race the database and exit on
        # its first connection attempt.
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: postgres
      # Set POSTGRES_PASSWORD in your shell or .env; this default is local-only.
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-postgres}
      POSTGRES_DB: ${name}
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d ${name}"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  pgdata:
`;
}

export function readmeMd(projectName: string, structure: AxumStructure, db: AxumDb): string {
  return `# ${projectName}

An Axum service generated with [buildquick](https://github.com/Oluiy/aggregator), using the
**${structure}** structure and **sqlx** on **${db === "sqlite" ? "SQLite" : "PostgreSQL"}**. See
[ARCHITECTURE.md](ARCHITECTURE.md) for why it is shaped this way.

## Run it

\`\`\`bash
cargo test                       # ${db === "sqlite" ? "unit and HTTP tests - no database server needed" : "unit tests (the HTTP tests need PostgreSQL - see below)"}
cargo run                        # http://127.0.0.1:3000
\`\`\`
${
  db === "postgres"
    ? `
### Database

\`\`\`bash
docker compose up -d db
export DATABASE_URL=postgres://postgres:CHANGE_ME@localhost:5432/${toSnake(projectName)}
cargo run
# the HTTP tests, against a throwaway database:
export TEST_DATABASE_URL=postgres://postgres:CHANGE_ME@localhost:5432/${toSnake(projectName)}_test
cargo test -- --ignored
\`\`\`
`
    : ""
}
Migrations in \`migrations/\` are embedded in the binary and applied at startup.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | \`/health\` | Liveness. Outside the version prefix, because probes use a fixed path. |
| GET | \`/api/v1/health/ready\` | Readiness - actually queries the database. |
| POST | \`/api/v1/items\` | Create an item. |
| GET | \`/api/v1/items?limit=50&offset=0\` | List items, paginated and capped at 200. |
| GET | \`/api/v1/items/{id}\` | Get one item, 404 when missing. |

## Cargo's own commands

\`\`\`bash
cargo add <crate>                # add a dependency at its current version
cargo clippy                     # lints
cargo fmt                        # formatting
\`\`\`

## Grade it

\`\`\`bash
buildquick check
\`\`\`
`;
}

export function architectureMd(projectName: string, structure: AxumStructure, db: AxumDb): string {
  const layout =
    structure === "clean"
      ? `\`\`\`
src/
  domain/            plain structs + the ItemRepository trait the domain requires
  application/       ItemService - the use cases, generic over the repository
  infrastructure/    the sqlx implementation of the trait, and its row type
  api/               axum handlers and the JSON response types
  config.rs  db.rs  error.rs  health.rs  middleware.rs  state.rs
migrations/          numbered SQL, embedded in the binary
tests/api.rs         HTTP tests through the router, in-process
\`\`\`

**Why:** dependencies point inward. \`domain/\` imports nothing from sqlx, serde or axum, so
the rules are tested with a \`Vec\` and a schema or JSON change cannot ripple into them. The
cost is real: an entity, a row type, a response type, and the mappings between them.
Worth it when the rules are complex or long-lived.`
      : `\`\`\`
src/
  items/
    entity.rs            Item - serde and sqlx traits derived directly
    repository.rs        the ItemRepository trait
    sqlx_repository.rs   its sqlx implementation
    service.rs           the business rules, generic over the repository
    handlers.rs          axum handlers
  config.rs  db.rs  error.rs  health.rs  middleware.rs  state.rs
migrations/            numbered SQL, embedded in the binary
tests/api.rs           HTTP tests through the router, in-process
\`\`\`

**Why:** idiomatic Rust for a service this size. One feature is one folder, and the entity
derives what it needs rather than being mirrored by a second struct. The service still
takes a *trait*, so it can be unit-tested with a fake. Move to the *clean* structure when
the domain needs to stop knowing about sqlx and serde.`;

  return `# Architecture

${projectName}, generated with buildquick. This records the decisions so the next person
does not have to reverse-engineer them.

## Structure: ${structure}

${layout}

## The rule that matters

**Dependencies point one way: handlers -> service -> repository -> database.**

- HTTP status codes are chosen in exactly one place (\`error.rs\` plus the handlers'
  \`to_api_error\`). The service returns \`ItemsError\`, plain Rust, so it could back a CLI
  or a queue consumer.
- SQL appears only in the repository. "Is this query indexed?" is answerable from one file.
- The service is generic over \`R: ItemRepository\`: static dispatch, no \`Box<dyn>\`, and a
  fake in tests.

## Decisions already made for you

| Decision | Why |
|---|---|
| **Per-client rate limiting** (\`tower_governor\`) | One misbehaving client or a credential-stuffing bot should not be able to take the service down. Applied to the whole router in \`middleware.rs\`, so a route added later is covered. Tune with \`RATE_LIMIT_PER_SECOND\` / \`RATE_LIMIT_BURST\`. |
| **A request timeout and a body limit** | A handler waiting on a slow dependency holds a worker indefinitely without one. A body no one asked for is memory the server pays for. |
| **Listing is paginated and capped at 200** | An unbounded list is fine at 200 rows and a timeout at 2 million. The ceiling is enforced in the handler, so no later query edit can remove it. |
| **Liveness and readiness are separate** | \`/health\` never touches the database. \`/api/v1/health/ready\` queries it and returns 503 on failure, so a process that cannot reach its database is pulled from the load balancer. |
| **Graceful shutdown** | Ctrl-C and SIGTERM finish in-flight requests, so a deploy does not drop connections mid-response. |
| **Internal errors are logged, never returned** | An error message can leak table names, SQL or paths to whoever triggered it. |
| **Bound query parameters** | A name is data, not SQL: nothing is built by string formatting. |
| **Migrations are embedded** | \`sqlx::migrate!\` compiles \`migrations/\` into the binary and applies them at startup, so the image ships no extra files. |
| **Dependencies are resolved by cargo** | \`cargo add\` picked the current versions. Commit \`Cargo.lock\` - for a binary, that is where reproducibility lives. |
${db === "sqlite" ? "| **SQLite pool waits are bounded** | `acquire_timeout` stops a slow query turning into a pile-up waiting for a connection. |\n" : "| **The pool is sized and bounded** | `max_connections` and `acquire_timeout` are set, so the service neither exhausts the database's connection limit nor queues forever. |\n"}
## Where to add things

| You want to... | Do this |
|---|---|
| Add an endpoint | A handler in \`${structure === "clean" ? "api/handlers.rs" : "items/handlers.rs"}\` and one \`.route(...)\` line in \`lib.rs\`. |
| Change the schema | A new \`migrations/NNNN_what_changed.sql\`. Never edit one that has been applied. |
| Call another service | Build the client with \`config.request_timeout_secs\`. A client with no timeout lets one slow dependency hold a worker open indefinitely. |
| Add auth | A \`tower\` layer or an axum extractor. Not included: the right choice depends on your identity provider. |

## What this scaffold deliberately does not include

Authentication, caching, tracing export and a message queue. Each is a real decision that
depends on your deployment, and a wrong default is worse than an obvious gap. Run
\`buildquick check\` on this project to see what it still flags, with the reasoning.
`;
}
