import { rel } from "../layout.js";
import { NODE_VERSIONS as V } from "../versions.js";
import type { NodeDb } from "../types.js";
import type { OrmContext, OrmPlugin } from "./types.js";

/**
 * Prisma 7. Everything below was learned from a real install: the schema has no `url`
 * (Prisma 7 rejects it), the "prisma-client" generator writes into src/generated, the CLI
 * reads DATABASE_URL from prisma.config.ts, and the client needs a driver adapter.
 */

function dbTs(ctx: OrmContext): string {
  const adapter =
    ctx.db === "postgres" ? `import { PrismaPg } from "@prisma/adapter-pg";` : `import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";`;
  const build = ctx.db === "postgres" ? "new PrismaPg({ connectionString: databaseUrl })" : "new PrismaBetterSqlite3({ url: databaseUrl })";

  return `${adapter}
import type { Database } from "./database.js";
import { PrismaClient } from "./generated/client.js";
import { PrismaItemsRepository } from "${rel("src/db.ts", ctx.paths.ormRepository)}";

/**
 * One PrismaClient for the process. Prisma 7 no longer reads the connection URL from
 * schema.prisma: the client is handed a driver adapter built from the validated config.
 * Creating a client per request is how a service exhausts the database's connections.
 */
export async function connect(databaseUrl: string): Promise<Database> {
  const prisma = new PrismaClient({ adapter: ${build} });
  return {
    repository: new PrismaItemsRepository(prisma),
    ping: async () => {
      await prisma.$queryRaw\`SELECT 1\`;
    },
    close: () => prisma.$disconnect(),
  };
}
`;
}

function repositoryTs(ctx: OrmContext): string {
  const { paths } = ctx;
  return `import type { PrismaClient } from "${rel(paths.ormRepository, "src/generated/client.ts")}";
import type { Item, NewItem } from "${rel(paths.ormRepository, paths.entity)}";
import type { ItemsRepository, Page } from "${rel(paths.ormRepository, paths.repository)}";

/** Maps the table row to the feature's Item: the one place that knows the row's shape. */
function toItem(row: { id: number; name: string; description: string | null }): Item {
  return { id: row.id, name: row.name, description: row.description };
}

/**
 * Every query against the items table lives here, so "is this query indexed?" is
 * answerable by reading one file.
 */
export class PrismaItemsRepository implements ItemsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async add(item: NewItem): Promise<Item> {
    return toItem(await this.prisma.item.create({ data: { name: item.name, description: item.description } }));
  }

  async find(id: number): Promise<Item | null> {
    const row = await this.prisma.item.findUnique({ where: { id } });
    return row === null ? null : toItem(row);
  }

  async page(limit: number, offset: number): Promise<Page> {
    // One round trip for both, and take/skip always: never an unbounded read.
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.item.findMany({ orderBy: { id: "asc" }, take: limit, skip: offset }),
      this.prisma.item.count(),
    ]);
    return { items: rows.map(toItem), total };
  }
}
`;
}

function schema(db: NodeDb): string {
  return `// Prisma 7: the "prisma-client" generator writes the client into your source tree (so tsc
// and vitest compile it like any other file) instead of into node_modules. The directory
// is gitignored and rebuilt by "npm install" (postinstall).
generator client {
  provider     = "prisma-client"
  output       = "../src/generated"
  moduleFormat = "esm"
}

// No "url" here: Prisma 7 rejects it. The CLI reads DATABASE_URL from prisma.config.ts,
// and the running app passes a driver adapter to PrismaClient.
datasource db {
  provider = "${db === "postgres" ? "postgresql" : "sqlite"}"
}

model Item {
  id          Int      @id @default(autoincrement())
  name        String
  description String?
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  // Listing sorts and filters on name, and an unindexed column is the first thing to hurt
  // once the table grows.
  @@index([name])
  @@map("items")
}
`;
}

const CONFIG = `// Read by the Prisma CLI (generate, db push, migrate). The running app does not use this
// file: it connects through the driver adapter in src/db.ts.
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Fails with the variable named when it is missing, rather than with an opaque
  // connection error later.
  datasource: { url: env("DATABASE_URL") },
});
`;

export const prismaPlugin: OrmPlugin = {
  id: "prisma",
  label: "Prisma 7",

  dependencies: (db) => ({
    "@prisma/client": V.prisma,
    // Prisma 7 requires a driver adapter; each one brings its own database driver.
    ...(db === "postgres" ? { "@prisma/adapter-pg": V.prismaAdapterPg } : { "@prisma/adapter-better-sqlite3": V.prismaAdapterSqlite }),
  }),
  devDependencies: () => ({ prisma: V.prisma, dotenv: V.dotenv }),
  scripts: () => ({
    postinstall: "prisma generate",
    "db:push": "prisma db push",
    "db:migrate": "prisma migrate dev",
    "db:deploy": "prisma migrate deploy",
  }),

  gitignore: "\n# Prisma's generated client (rebuilt by postinstall) and local databases\n/src/generated\n*.db\n*.db-journal\n",

  files: (ctx) => [
    { path: "src/db.ts", content: dbTs(ctx) },
    { path: ctx.paths.ormRepository, content: repositoryTs(ctx) },
    { path: "prisma/schema.prisma", content: schema(ctx.db) },
    { path: "prisma.config.ts", content: CONFIG },
  ],

  createSchemaImports: `import { spawnSync } from "node:child_process";`,

  createSchemaSnippet: () => `// --url overrides the datasource in prisma.config.ts for this one command.
  const result = spawnSync("npx", ["prisma", "db", "push", "--url", url], { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    throw new Error("prisma db push failed for the test database");
  }`,

  docker: {
    // prisma.config.ts uses env("DATABASE_URL"), which throws when it is unset - and "npm
    // ci" runs prisma generate (postinstall) before anything could supply one. generate
    // never connects, so a placeholder satisfies it. Builder stage only: the runtime image
    // does not get it, so a real DATABASE_URL is still required there.
    buildEnv: (db) =>
      `\n# Build-time only (this stage is discarded): lets "prisma generate" load its config.\nENV DATABASE_URL="${db === "postgres" ? "postgresql://build:build@localhost:5432/build" : "file:./build-only.db"}"\n`,
    copyBeforeInstall: ["COPY prisma ./prisma", "COPY prisma.config.ts ./"],
    generateStep: "\n# The Prisma client is generated code, so it has to exist before the build.\nRUN npx prisma generate\n",
  },

  docs: {
    setupSteps: () => "cp .env.example .env\nnpm run db:push                  # create the schema\n",
    schemaChange: "Edit `prisma/schema.prisma`, then `npm run db:migrate -- --name what_changed`. Read the generated SQL before applying it.",
    sqlLives: 'Prisma appears only in the repository. "Is this query indexed?" is answerable from one file.',
    decisions:
      "| **Prisma 7 specifics** | The schema has no `url` (Prisma 7 rejects it): the CLI reads `DATABASE_URL` from `prisma.config.ts` and the app passes a driver adapter to `PrismaClient`. The client is generated into `src/generated` (gitignored, rebuilt by `npm install`). |\n",
  },
};
