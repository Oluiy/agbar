import { NEST_VERSIONS as V } from "../versions.js";
import type { NestDb, NestOrm, NestStructure } from "../types.js";

/** Project-level files: manifest, TypeScript and Jest config, docs. */

const JEST = "node --experimental-vm-modules ./node_modules/jest/bin/jest.js";

/** Maps a relative "./x.js" import back to the "x.ts" file TypeScript resolved it from. */
const JS_EXTENSION_MAP = { "^(\\.{1,2}/.*)\\.js$": "$1" };

/**
 * The dependencies and scripts buildquick adds on top of a base.
 *
 * Split out from packageJson so the CLI path can merge exactly these into the
 * manifest `nest new` wrote - keeping the Nest team's versions for everything they
 * already pin, and adding only what they do not know about.
 */
export function packageAdditions(
  orm: NestOrm,
  db: NestDb
): {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
} {
  const manifest = JSON.parse(packageJson("placeholder", orm, db)) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    scripts: Record<string, string>;
  };
  return { dependencies: manifest.dependencies, devDependencies: manifest.devDependencies, scripts: manifest.scripts };
}

export function packageJson(projectName: string, orm: NestOrm, db: NestDb): string {
  const deps: Record<string, string> = {
    "@nestjs/common": V.nest,
    "@nestjs/config": V.nestConfig,
    "@nestjs/core": V.nest,
    "@nestjs/platform-express": V.nest,
    "@nestjs/throttler": V.nestThrottler,
    "class-transformer": V.classTransformer,
    "class-validator": V.classValidator,
    "reflect-metadata": V.reflectMetadata,
    rxjs: V.rxjs,
  };
  const devDeps: Record<string, string> = {
    // The CLI is how a Nest project is built and extended - `nest g resource x`
    // updates the neighbouring module's imports, `nest start --watch` reloads.
    // Exactly what `nest new` would leave here.
    "@nestjs/cli": V.nestCli,
    "@nestjs/schematics": V.nestSchematics,
    "@nestjs/testing": V.nest,
    // @nestjs/platform-express does not bring Express's own types, and the health
    // controller imports its Response type.
    "@types/express": V.typesExpress,
    "@types/jest": V.typesJest,
    "@types/node": V.typesNode,
    "@types/supertest": V.typesSupertest,
    jest: V.jest,
    supertest: V.supertest,
    "ts-jest": V.tsJest,
    // Deliberately 6.x: ts-jest's peer range is ">=4.3 <7" and @nestjs/schematics
    // wants ">=6.0.0", so 6 is the only version that installs at all.
    typescript: V.typescript,
  };

  const scripts: Record<string, string> = {
    // The Nest CLI's own commands, not hand-rolled tsc calls: `nest build` knows
    // about tsconfig.build.json and can switch compiler (tsc/swc/rspack), and
    // `nest start --watch` gives live reload.
    build: "nest build",
    start: "nest start",
    "start:dev": "nest start --watch",
    "start:debug": "nest start --debug --watch",
    "start:prod": "node dist/main",
    // NestJS 12's packages are ES modules, which Jest can only load through Node's
    // --experimental-vm-modules. This is exactly what `nest new` writes (verified in
    // @nestjs/schematics); plain `jest` fails with "Must use import to load ES Module".
    test: JEST,
    "test:watch": `${JEST} --watch`,
    "test:cov": `${JEST} --coverage`,
  };

  if (orm === "prisma") {
    deps["@prisma/client"] = V.prisma;
    // Prisma 7 requires a driver adapter; each one brings its own database driver.
    deps[db === "postgres" ? "@prisma/adapter-pg" : "@prisma/adapter-better-sqlite3"] = db === "postgres" ? V.prismaAdapterPg : V.prismaAdapterSqlite;
    devDeps.prisma = V.prisma;
    devDeps.dotenv = V.dotenv;
    scripts.postinstall = "prisma generate";
    scripts["db:push"] = "prisma db push";
    scripts["db:migrate"] = "prisma migrate dev";
    scripts["db:deploy"] = "prisma migrate deploy";
    // The e2e suite talks to a real database, so npm runs this "pre<script>" first to
    // create the schema in a DEDICATED test database (TEST_DATABASE_URL, or a local
    // SQLite file). It deliberately never uses --force-reset or the app's DATABASE_URL:
    // an earlier version did, which would wipe a real dev database for anyone whose
    // .env pointed at one - and Prisma itself refuses that when it detects an AI agent.
    scripts["pretest:e2e"] = "node scripts/prepare-e2e-db.mjs";
    scripts["test:e2e"] = `${JEST} --config jest-e2e.json`;
  }
  if (orm === "typeorm") {
    deps["@nestjs/typeorm"] = V.nestTypeorm;
    deps.typeorm = V.typeorm;
    if (db === "postgres") deps.pg = V.pg;
    else {
      deps["better-sqlite3"] = V.betterSqlite3;
      devDeps["@types/better-sqlite3"] = V.typesBetterSqlite3;
    }
  }

  return `${JSON.stringify(
    {
      name: projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      version: "0.1.0",
      description: `${projectName} - a NestJS service`,
      private: true,
      // NestJS 12 needs a recent Node; declaring it turns a confusing runtime failure
      // into a clear EBADENGINE message at install time.
      engines: { node: V.nodeEngine },
      scripts,
      dependencies: sortKeys(deps),
      devDependencies: sortKeys(devDeps),
      jest: {
        moduleFileExtensions: ["js", "json", "ts"],
        rootDir: "src",
        testRegex: ".*\\.spec\\.ts$",
        transform: { "^.+\\.(t|j)s$": "ts-jest" },
        // Under nodenext, Prisma 7's generated client imports "./internal/class.js" for a
        // file that is class.ts on disk. TypeScript maps that; Jest does not, so strip
        // the extension and let it resolve the .ts. Only found on a clean install.
        moduleNameMapper: JS_EXTENSION_MAP,
        collectCoverageFrom: ["**/*.(t|j)s"],
        coverageDirectory: "../coverage",
        testEnvironment: "node",
      },
    },
    null,
    2
  )}\n`;
}

function sortKeys(obj: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
}

export function tsconfigJson(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        // NestJS 12 is ESM-only; "commonjs" cannot resolve its packages. nodenext
        // (what `nest new` writes) lets this CommonJS-typed project require() them.
        module: "nodenext",
        moduleResolution: "nodenext",
        resolvePackageJsonExports: true,
        isolatedModules: true,
        declaration: true,
        removeComments: true,
        // Both are required for Nest's DI: the decorators themselves, and the
        // type metadata Nest reads to know what to inject.
        emitDecoratorMetadata: true,
        experimentalDecorators: true,
        // Required, not optional: `import request from "supertest"` and Express's
        // CJS exports only work as default imports with interop emitted.
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        // TypeScript 6 stopped auto-including every installed @types/* package, so
        // without this "describe", "it" and "process" are all undefined even with
        // @types/jest and @types/node installed.
        types: ["node", "jest"],
        target: "ES2023",
        sourceMap: true,
        outDir: "./dist",
        // No baseUrl: TypeScript 6 hard-errors on it (TS5101, deprecated and removed in
        // 7). It is only needed alongside "paths", which this does not use.
        // rootDir "." is required by TypeScript 6 (TS5011: it no longer infers a common
        // source directory) and covers test/ as well as src/. tsconfig.build.json narrows
        // it to ./src so the build emits dist/main.js.
        rootDir: ".",
        incremental: true,
        skipLibCheck: true,
        // On: the whole point of TypeScript is catching the null you forgot.
        strict: true,
        strictNullChecks: true,
        noImplicitAny: true,
        forceConsistentCasingInFileNames: true,
        noFallthroughCasesInSwitch: true,
      },
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
      // rootDir ./src makes the build emit dist/main.js rather than dist/src/main.js,
      // which is the path "start:prod" runs.
      compilerOptions: { rootDir: "./src" },
      include: ["src"],
      exclude: ["node_modules", "test", "dist", "**/*spec.ts"],
    },
    null,
    2
  )}\n`;
}

export function nestCliJson(): string {
  return `${JSON.stringify({ $schema: "https://json.schemastore.org/nest-cli", collection: "@nestjs/schematics", sourceRoot: "src", compilerOptions: { deleteOutDir: true } }, null, 2)}\n`;
}

/** The URL the e2e suite uses: never the app's DATABASE_URL, so a test run cannot touch real data. */
function e2eUrlExpression(db: NestDb, projectName: string): string {
  if (db === "postgres") return "process.env.TEST_DATABASE_URL";
  return `process.env.TEST_DATABASE_URL ?? "file:./${projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-e2e.db"`;
}

/** Creates the schema in the dedicated test database before the e2e suite runs. */
export function prepareE2eDbMjs(db: NestDb, projectName: string): string {
  return `// Runs before "npm run test:e2e". Creates the schema in a DEDICATED test database.
//
// Never uses the app's DATABASE_URL and never passes --force-reset: pointing a reset
// at whatever .env contains would wipe a real development database.
import { spawnSync } from "node:child_process";

const url = ${e2eUrlExpression(db, projectName)};

if (!url) {
  console.error(
    "TEST_DATABASE_URL is not set. The e2e suite needs its own database, separate from DATABASE_URL, " +
      "so a test run cannot touch real data. Point it at a throwaway database and re-run.",
  );
  process.exit(1);
}

// --url overrides the datasource in prisma.config.ts for this one command.
const result = spawnSync("npx", ["prisma", "db", "push", "--url", url], { stdio: "inherit", shell: process.platform === "win32" });
process.exit(result.status ?? 1);
`;
}

/** Points the app at the test database for the e2e run, before AppModule reads its config. */
export function setDatabaseUrlJs(db: NestDb, projectName: string): string {
  return `// Jest setup file for the e2e suite: aim the app at the dedicated test database, not
// the one in DATABASE_URL. Real environment variables win over .env in @nestjs/config,
// so setting this before AppModule loads is enough.
const url = ${e2eUrlExpression(db, projectName)};

if (url) {
  process.env.DATABASE_URL = url;
}
`;
}

export function jestE2eJson(): string {
  return `${JSON.stringify(
    {
      moduleFileExtensions: ["js", "json", "ts"],
      rootDir: ".",
      testEnvironment: "node",
      setupFiles: ["./test/set-database-url.js"],
      testRegex: ".e2e-spec.ts$",
      moduleNameMapper: JS_EXTENSION_MAP,
      transform: { "^.+\\.(t|j)s$": "ts-jest" },
    },
    null,
    2
  )}\n`;
}

export function envExample(projectName: string, orm: NestOrm, db: NestDb): string {
  const name = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const url =
    orm === "none"
      ? ""
      : db === "sqlite"
        ? `DATABASE_URL="file:./${name}.db"\n`
        : `# Replace the password before using this anywhere real.
DATABASE_URL="postgresql://postgres:CHANGE_ME@localhost:5432/${name}?schema=public"\n`;

  return `# Copy to .env and edit. .env is gitignored; this file documents the shape.
NODE_ENV=development
PORT=3000
${url}# Outbound HTTP: most clients have no timeout unless you set one.
REQUEST_TIMEOUT_MS=10000
# Rate limiting (requests per window, window in ms).
THROTTLE_TTL_MS=60000
THROTTLE_LIMIT=100
`;
}

export function gitignore(orm: NestOrm): string {
  const prisma = orm === "prisma" ? "\n# Prisma's generated client (rebuilt by postinstall) and local databases\n/src/generated\n*.db\n*.db-journal\n" : "";
  return `# Secrets - .env.example documents the shape instead.
.env
.env.*
!.env.example

# Build output and dependencies
/node_modules
/dist
/coverage
*.tsbuildinfo

# Logs
*.log
npm-debug.log*
${prisma}
# Editors / OS
.idea/
.vscode/
.DS_Store
`;
}

export function readmeMd(projectName: string, structure: NestStructure, orm: NestOrm, db: NestDb): string {
  const dbSteps =
    orm === "prisma"
      ? `
## Database

\`\`\`bash
cp .env.example .env${db === "postgres" ? "\ndocker compose up -d db          # starts PostgreSQL" : ""}
npm run db:push                  # create the schema from prisma/schema.prisma
# or, once you want a reviewable history:
npm run db:migrate -- --name init
\`\`\`
`
      : "";

  return `# ${projectName}

A NestJS service generated with [buildquick](https://github.com/Oluiy/aggregator),
using the **${structure}** structure${orm === "none" ? "" : ` and **${orm}**`}. See
[ARCHITECTURE.md](ARCHITECTURE.md) for why it is shaped this way.

## Run it

\`\`\`bash
npm install
npm test                         # unit + health tests, no database needed
npm run start:dev                # live reload via the Nest CLI
\`\`\`

The Nest CLI is a devDependency, so the commands you already know work here:

\`\`\`bash
npm run build                    # nest build
npm run start:dev                # nest start --watch
npx nest g resource modules/orders   # writes the files AND updates the module imports
npx nest info                    # versions, for a bug report
\`\`\`
${dbSteps}
## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | \`/health\` | Liveness. Outside the version prefix, because probes use a fixed path. |
| GET | \`/api/v1/health/ready\` | Readiness${orm === "none" ? "" : " - actually queries the database"}. |
${
  orm === "none"
    ? ""
    : `| POST | \`/api/v1/items\` | Create an item. |
| GET | \`/api/v1/items?limit=50&offset=0\` | List items, paginated and capped at 200. |
| GET | \`/api/v1/items/:id\` | Get one item, 404 when missing. |
`
}
## Tests

\`\`\`bash
npm test            # unit tests and the health check - no database required
${orm === "prisma" ? "npm run test:e2e    # full HTTP tests; resets a throwaway database first\n" : ""}\`\`\`

## Grade it

\`\`\`bash
buildquick check
\`\`\`
`;
}

export function architectureMd(projectName: string, structure: NestStructure, orm: NestOrm): string {
  const layout =
    structure === "clean"
      ? `\`\`\`
src/
  modules/items/
    domain/          item.entity.ts, items.repository.port.ts - no Nest, no Prisma
    application/     items.service.ts - the use cases
    infrastructure/  prisma-items.repository.ts - implements the port
    api/             items.controller.ts, dto/ - HTTP only
    items.module.ts  binds the port to the implementation
  common/            filters, interceptors shared across modules
  config/            typed configuration
  health/
\`\`\`

**Why:** the port/adapter boundary is explicit. \`items.module.ts\` is the only file
that knows which implementation backs \`ITEMS_REPOSITORY\`, so swapping Prisma for
anything else is one line and the service never changes. The cost is the extra
indirection - worth it when the rules outlive the storage choice.`
      : `\`\`\`
src/
  modules/items/
    items.controller.ts   HTTP only: routes, status codes, DTOs
    items.service.ts      business rules
    items.repository.ts   every query for this feature
    dto/                  request/response shapes, validated at the edge
    items.module.ts
  common/                 shared filters and interceptors
  config/                 typed configuration
  health/
\`\`\`

**Why:** the NestJS default, and what most Nest codebases look like. One feature is
one folder, so it can be read, reviewed or deleted as a unit. The repository stays a
separate class (rather than calling Prisma from the service) so "where are the
queries?" has one answer per feature.`;

  return `# Architecture

${projectName}, generated with buildquick. This records the decisions so the next
person does not have to reverse-engineer them.

## Structure: ${structure}

${layout}

## The rule that matters

**Dependencies point one way: controller -> service -> repository -> database.**

- \`HttpException\` appears only in controllers and filters. The service throws
  \`ItemNotFoundError\`, a plain class, so the same service can back a queue consumer.
- ${orm === "none" ? "Data access, when you add it, belongs in a repository - not in the service." : 'Prisma appears only in the repository. "Is this query indexed?" is answerable from one file.'}
- DTOs are the edge contract, validated by a global \`ValidationPipe\` with
  \`whitelist\` and \`forbidNonWhitelisted\`, so an unexpected field is rejected
  rather than silently ignored.

## Decisions already made for you

| Decision | Why |
|---|---|
| **Rate limiting is on by default** (\`@nestjs/throttler\`, global guard) | One misbehaving client or a credential-stuffing bot should not be able to take the service down. Configured once in \`AppModule\`, so it applies to every route added later. |
| **Listing is paginated and capped at 200** | An unbounded list is fine at 200 rows and a timeout at 2 million. The cap lives in the DTO, so validation enforces it before the handler runs. |
| **Liveness and readiness are separate** | \`/health\` answers "am I running?" and is excluded from the version prefix because probes point at a fixed path. \`/api/v1/health/ready\`${orm === "none" ? " is where dependency checks belong as you add them" : " queries the database and returns 503 when it cannot reach it"}. |
| **Config is typed and validated at startup** | A missing or malformed variable fails immediately with a clear message, instead of surfacing as a confusing error on the first request. |
| **\`enableShutdownHooks\`** | SIGTERM drains in-flight requests and closes the database pool, rather than cutting connections mid-response during a deploy. |
| **No credentials in source** | \`DATABASE_URL\` comes from the environment; \`.env\` is gitignored and \`.env.example\` documents the shape. |
| **TypeScript is pinned to 5.x, not 7.x** | \`ts-jest\` declares \`typescript: ">=4.3 <7"\`. Generating the newest TypeScript would produce a project that cannot run its own tests. |
${orm === "prisma" ? `| **Prisma client, CLI and adapter share a major** | They are a matched set; a mismatch fails at \`prisma generate\`. The CLI's \`latest\` is currently an 8.x release candidate, so all three are pinned to 7. |\n| **Prisma 7 specifics** | The schema has no \`url\` (Prisma 7 rejects it): the CLI reads \`DATABASE_URL\` from \`prisma.config.ts\`, and the app passes a driver adapter to \`PrismaClient\`. The client is generated into \`src/generated\` (gitignored, rebuilt by \`npm install\`). |\n| **NestJS 12 needs a recent Node** | \`engines\` requires Node ^22.22.3, ^24.15 or 26+; older versions install with EBADENGINE warnings. |\n| **\`prisma migrate\` owns the schema** | \`db:push\` is for the first run and for throwaway test databases. Real changes are reviewable migration files with an ordered history. |\n` : ""}
## Where to add things

| You want to... | Do this |
|---|---|
| Add a feature | \`nest g module modules/<name>\` then the controller, service and repository beside it. Import the module in \`app.module.ts\`. |
| Add an endpoint to an existing feature | Add the method to the controller and a DTO beside it. Validation is automatic. |
${orm === "prisma" ? "| Change the schema | Edit `prisma/schema.prisma`, then `npm run db:migrate -- --name what_changed`. Read the generated SQL before applying it. |\n" : ""}| Call another service | Set a timeout from config on the client. A client with no timeout lets one slow dependency hold a worker open indefinitely. |
| Add auth | A guard, applied globally in \`AppModule\` or per-route with \`@UseGuards\`. Not included here: the right choice depends on your identity provider. |

## What this scaffold deliberately does not include

Authentication, caching, tracing and a message queue. Each is a real decision that
depends on your deployment, and a wrong default is worse than an obvious gap. Run
\`buildquick check\` on this project to see what it still flags, with the reasoning.
`;
}
