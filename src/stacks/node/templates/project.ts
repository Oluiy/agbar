import { toPackageName } from "../layout.js";
import { ormPlugin } from "../orms/index.js";
import { NODE_VERSIONS as V } from "../versions.js";
import type { NodeDb, NodeFramework, NodeOrm, NodeStructure } from "../types.js";

export function packageJson(projectName: string, framework: NodeFramework, orm: NodeOrm, db: NodeDb): string {
  const deps: Record<string, string> = { zod: V.zod };
  const devDeps: Record<string, string> = {
    "@types/node": V.typesNode,
    tsx: V.tsx,
    typescript: V.typescript,
    vitest: V.vitest,
  };

  if (framework === "express") {
    Object.assign(deps, { express: V.express, helmet: V.helmet, "express-rate-limit": V.expressRateLimit });
    Object.assign(devDeps, { "@types/express": V.typesExpress, supertest: V.supertest, "@types/supertest": V.typesSupertest });
  } else {
    Object.assign(deps, { fastify: V.fastify, "@fastify/helmet": V.fastifyHelmet, "@fastify/rate-limit": V.fastifyRateLimit });
  }

  const scripts: Record<string, string> = {
    // --env-file-if-exists (Node 22.9+) loads .env without a dotenv runtime dependency.
    dev: "tsx watch --env-file-if-exists=.env src/server.ts",
    build: "tsc -p tsconfig.build.json",
    start: "node --env-file-if-exists=.env dist/server.js",
    typecheck: "tsc --noEmit",
    test: "vitest run",
    "test:watch": "vitest",
  };

  const plugin = ormPlugin(orm);
  if (plugin) {
    Object.assign(deps, plugin.dependencies(db));
    Object.assign(devDeps, plugin.devDependencies(db));
    Object.assign(scripts, plugin.scripts(db));
  }

  const sort = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  return `${JSON.stringify(
    {
      name: toPackageName(projectName),
      version: "0.1.0",
      description: `${projectName} - an ${framework === "express" ? "Express" : "Fastify"} service`,
      private: true,
      // ES modules: Express 5, Fastify 5, zod 4 and Prisma 7's generated client are all
      // used as ESM here, and vitest runs them natively.
      type: "module",
      engines: { node: V.nodeEngine },
      scripts,
      dependencies: sort(deps),
      devDependencies: sort(devDeps),
    },
    null,
    2
  )}\n`;
}

export function tsconfigJson(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        // nodenext: real ESM resolution, so relative imports carry a ".js" extension -
        // exactly what the compiled output needs at run time.
        module: "nodenext",
        moduleResolution: "nodenext",
        target: "ES2023",
        strict: true,
        esModuleInterop: true,
        isolatedModules: true,
        skipLibCheck: true,
        // TypeScript 6 stopped auto-including every @types/* package, so without this
        // "process" and "console" are undefined even with @types/node installed.
        types: ["node"],
        // TypeScript 6 requires an explicit rootDir (it no longer infers one).
        rootDir: ".",
        outDir: "./dist",
        sourceMap: true,
      },
      // *.config.ts picks up vitest.config.ts and whichever ORM config the project has
      // (prisma.config.ts, drizzle.config.ts), so they are type-checked too.
      include: ["src", "test", "*.config.ts"],
      exclude: ["node_modules", "dist"],
    },
    null,
    2
  )}\n`;
}

export function tsconfigBuildJson(): string {
  return `${JSON.stringify(
    {
      extends: "./tsconfig.json",
      // rootDir ./src makes the build emit dist/server.js, which is the path "start" runs.
      compilerOptions: { rootDir: "./src" },
      include: ["src"],
      exclude: ["node_modules", "dist", "test"],
    },
    null,
    2
  )}\n`;
}

export function vitestConfigTs(orm: NodeOrm): string {
  const setup = orm !== "none" ? `    globalSetup: ["./test/global-setup.ts"],\n` : "";
  return `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
${setup}    include: ["test/**/*.test.ts"],
  },
});
`;
}

export function envExample(projectName: string, orm: NodeOrm, db: NodeDb): string {
  const name = toPackageName(projectName);
  const dbLines =
    orm === "none"
      ? ""
      : db === "sqlite"
        ? `DATABASE_URL=file:./${name}.db\n`
        : `# Replace the password before using this anywhere real.
DATABASE_URL=postgresql://postgres:CHANGE_ME@localhost:5432/${name}
# The repository tests use their own database - never DATABASE_URL.
TEST_DATABASE_URL=postgresql://postgres:CHANGE_ME@localhost:5432/${name}_test
`;
  return `# Copy to .env and edit. .env is gitignored; this file documents the shape.
# "npm run dev" and "npm start" load .env themselves (node --env-file-if-exists).
PORT=3000
${dbLines}REQUEST_TIMEOUT_MS=10000
MAX_BODY_BYTES=1048576
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000
`;
}

export function gitignore(orm: NodeOrm): string {
  const prisma = ormPlugin(orm)?.gitignore ?? "";
  return `# Secrets - .env.example documents the shape instead.
.env
.env.*
!.env.example

# Dependencies and build output
node_modules/
dist/
coverage/
*.tsbuildinfo
*.log
${prisma}
# Editors / OS
.idea/
.vscode/
.DS_Store
`;
}

export function dockerfile(orm: NodeOrm, db: NodeDb): string {
  // The ORM decides whether the build needs a codegen step, extra files copied early, or a
  // build-time placeholder environment (see each plug-in for why).
  const plugin = ormPlugin(orm);
  const generate = plugin?.docker.generateStep ?? "";
  const buildEnv = plugin?.docker.buildEnv(db) ?? "";
  const copies = (plugin?.docker.copyBeforeInstall ?? []).map((line) => `${line}\n`).join("");
  return `# Pinned to a major: "node:latest" would silently change Node under you.
# Debian trixie (glibc 2.41), not the default bookworm (2.36): prebuilt native modules such
# as sqlite3 are built on newer systems and refuse to load on an older glibc
# ("GLIBC_2.38 not found") - the container builds fine and then crashes on start.
FROM node:24-trixie-slim AS builder

WORKDIR /app
${buildEnv}
# Manifests first: editing a .ts file then does not invalidate the dependency layer.
# "npm ci" needs a package-lock.json - run "npm install" once and commit the lock file.
COPY package*.json ./
${copies}# A BuildKit cache mount: rebuilds reuse downloaded packages, and an interrupted build
# (a registry timeout) resumes instead of starting the download over.
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .
${generate}RUN npm run build \\
    # Drops dev dependencies but keeps native modules (the SQLite driver) already built.
    && npm prune --omit=dev

# A second stage so the image ships without TypeScript, vitest or the test suite.
FROM node:24-trixie-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
# node_modules comes from the builder, already pruned to production dependencies. Running
# "npm ci" here instead would re-run install scripts: the postinstall needs the prisma CLI
# (a dev dependency), and --ignore-scripts would skip the SQLite driver's native build.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Never root: a compromised container should not also be privileged. The node image
# ships a "node" user for exactly this.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \\
    CMD node -e "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Environment comes from the platform, so no --env-file: DATABASE_URL must be provided.
CMD ["node", "dist/server.js"]
`;
}

export function dockerCompose(projectName: string, orm: NodeOrm, db: NodeDb): string {
  const name = toPackageName(projectName).replace(/-/g, "_");
  if (orm === "none" || db !== "postgres") {
    return `services:
  api:
    build: .
    ports:
      - "3000:3000"
    environment:${orm === "none" ? '\n      PORT: "3000"' : `\n      DATABASE_URL: file:/data/${name}.db`}
    ${orm === "none" ? "" : "volumes:\n      - data:/data\n    "}restart: unless-stopped
${orm === "none" ? "" : "\nvolumes:\n  data:\n"}`;
  }
  return `services:
  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      # Inside the compose network the host is the service name, not localhost.
      DATABASE_URL: postgresql://postgres:\${POSTGRES_PASSWORD:-postgres}@db:5432/${name}
    depends_on:
      db:
        # Not just "started": the API would otherwise race the database on first query.
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

export function readmeMd(projectName: string, framework: NodeFramework, structure: NodeStructure, orm: NodeOrm, db: NodeDb): string {
  const label = framework === "express" ? "Express 5" : "Fastify 5";
  const plugin = ormPlugin(orm);
  return `# ${projectName}

A ${label} service in TypeScript, generated with [agbar](https://github.com/Oluiy/agbar),
using the **${structure}** structure${plugin ? ` and **${plugin.label}** on **${db === "sqlite" ? "SQLite" : "PostgreSQL"}**` : ""}. See
[ARCHITECTURE.md](ARCHITECTURE.md) for why it is shaped this way.

Needs **Node ${V.nodeEngine.replace(/\^/g, "")}** (vitest 5's requirement).

## Run it

\`\`\`bash
npm install
npm test                         # ${orm === "none" ? "unit and HTTP tests" : db === "sqlite" ? "unit, HTTP and repository tests - no database server needed" : "unit and HTTP tests (the repository tests need PostgreSQL - see below)"}
${plugin ? plugin.docs.setupSteps(db) : ""}npm run dev                      # http://localhost:3000, reloads on change
\`\`\`
${
  plugin && db === "postgres"
    ? `
### Database

\`\`\`bash
docker compose up -d db
export TEST_DATABASE_URL=postgresql://postgres:CHANGE_ME@localhost:5432/${toPackageName(projectName).replace(/-/g, "_")}_test
npm test                         # now includes the repository tests
\`\`\`
`
    : ""
}
## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | \`/health\` | Liveness. Outside the version prefix and never throttled, because probes use a fixed path. |
| GET | \`/api/v1/health/ready\` | Readiness${orm === "none" ? "" : " - actually queries the database"}. |
${
  orm === "none"
    ? ""
    : `| POST | \`/api/v1/items\` | Create an item. |
| GET | \`/api/v1/items?limit=50&offset=0\` | List items, paginated; \`limit\` above 200 is a 400. |
| GET | \`/api/v1/items/:id\` | Get one item, 404 when missing. |
`
}
## Scripts

\`\`\`bash
npm run build                    # tsc -> dist/
npm start                        # node dist/server.js
npm run typecheck
\`\`\`

## Grade it

\`\`\`bash
agbar check
\`\`\`
`;
}

export function architectureMd(projectName: string, framework: NodeFramework, structure: NodeStructure, orm: NodeOrm): string {
  const web = framework === "express" ? "Express" : "Fastify";
  const plugin = ormPlugin(orm);
  const ormName = plugin ? plugin.label.split(" ")[0] : "the ORM";
  const layout =
    structure === "clean"
      ? `\`\`\`
src/
  domain/            plain types + the ItemsRepository interface the domain requires
  application/       ItemsService - the use cases, depends only on that interface
  infrastructure/    the ${ormName} implementation of the interface
  api/               zod schemas and the ${web} routes
  app.ts  config.ts  database.ts  db.ts  errors.ts  server.ts
test/                unit, HTTP and repository tests
\`\`\`

**Why:** dependencies point inward. \`domain/\` imports nothing from ${ormName}, zod or ${web}, so the
rules are tested with an array and a schema or JSON change cannot ripple into them. The cost
is real: an entity, a row mapping and a schema per feature. Worth it when the rules are
complex or long-lived.`
      : `\`\`\`
src/
  items/
    entity.ts             Item - the shape the feature uses, not the database row
    repository.ts         the ItemsRepository interface
    ${orm}-repository.ts  its ${ormName} implementation
    service.ts            the business rules
    schemas.ts            zod request validation
    http.ts               the ${web} routes
  app.ts  config.ts  database.ts  db.ts  errors.ts  server.ts
test/                unit, HTTP and repository tests
\`\`\`

**Why:** one feature is one folder, so it can be read, reviewed or deleted as a unit. The
service still takes an *interface*, so it is unit-tested with an array. Move to the *clean*
structure when the domain needs to stop knowing about ${ormName} and zod.`;

  return `# Architecture

${projectName}, generated with agbar. This records the decisions so the next person
does not have to reverse-engineer them.

## Structure: ${structure}

${layout}

## The rule that matters

**Dependencies point one way: routes -> service -> repository -> database.**

- HTTP status codes are chosen in one place, the error handler in \`app.ts\`. The service throws
  \`NotFoundError\` and \`InvalidInputError\` - plain classes - so it could back a CLI or a queue.
- ${plugin ? plugin.docs.sqlLives : "Data access, when you add it, belongs in a repository - not in the service."}
- \`buildApp(deps)\` returns the app without listening, so tests drive it in-process and
  \`server.ts\` is the only file that knows about ports and signals.

## Decisions already made for you

| Decision | Why |
|---|---|
| **Per-client rate limiting** (${framework === "express" ? "\`express-rate-limit\`" : "\`@fastify/rate-limit\`"}) | One misbehaving client or a credential-stuffing bot should not take the service down. Applied to every route, probes excepted. Tune with \`RATE_LIMIT_MAX\` / \`RATE_LIMIT_WINDOW_MS\`. |
| **Security headers** (${framework === "express" ? "\`helmet\`" : "\`@fastify/helmet\`"}) | Sensible defaults for clickjacking, MIME sniffing and referrer leaks, on by default. |
| **Request timeout and body limit** | A stalled client cannot hold a socket open indefinitely, and a body no one asked for is memory the server pays for. |
| **Input is validated and unknown fields rejected** (zod \`strictObject\`) | A typo'd field is a 400, not a value silently dropped. |
| **Paginated and capped at 200** | An unbounded list is fine at 200 rows and a timeout at 2 million. The ceiling is in the schema, so validation enforces it before any code runs. |
| **Liveness and readiness are separate** | \`/health\` never touches the database. \`/api/v1/health/ready\`${orm === "none" ? " is where dependency checks belong as you add them" : " queries it and returns 503 on failure, so a process that cannot reach its database is pulled from the load balancer"}. Neither is throttled. |
| **Config is validated at startup** (zod) | A missing or malformed variable stops the process naming the variable, instead of a confusing error on the first request. |
| **Graceful shutdown** | SIGTERM and SIGINT finish in-flight requests${orm === "none" ? "" : " and close the database"}, so a deploy does not drop connections mid-response. |
| **Internal errors are logged, never returned** | An error message can leak table names, SQL or paths. |
| **ES modules, \`nodenext\`** | Relative imports carry \`.js\`, matching what the compiled output needs at run time. |
| **TypeScript ${V.typescript.replace("^", "")}, not 7** | The line this toolchain was verified against; moving to 7 is a decision, not a bump. |
${plugin ? `${plugin.docs.decisions}| **Tests never touch \`DATABASE_URL\`** | The repository tests use \`TEST_DATABASE_URL\` or a temporary SQLite file, and never reset or drop anything: resetting whatever \`.env\` points at would wipe a real database. |\n` : ""}
## Where to add things

| You want to... | Do this |
|---|---|
| Add an endpoint | A handler in the feature's ${structure === "clean" ? "\`api/http.ts\`" : "\`items/http.ts\`"}, with a zod schema beside it. |
${plugin ? `| Change the schema | ${plugin.docs.schemaChange} |\n` : ""}| Call another service | Set a timeout on the client from config. A client with no timeout lets one slow dependency hold a worker open indefinitely. |
| Add auth | ${framework === "express" ? "A middleware before the routes" : "A \`preHandler\` hook or plugin"}. Not included: the right choice depends on your identity provider. |

## What this scaffold deliberately does not include

Authentication, caching, tracing export and a message queue. Each is a real decision that
depends on your deployment, and a wrong default is worse than an obvious gap. Run
\`agbar check\` on this project to see what it still flags, with the reasoning.
`;
}
