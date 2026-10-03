import { rel } from "../layout.js";
import { NODE_VERSIONS as V } from "../versions.js";
import type { NodeDb } from "../types.js";
import type { OrmContext, OrmPlugin } from "./types.js";

/**
 * Drizzle ORM on the stable 0.x line (drizzle-orm 0.45 + drizzle-kit 0.31). The schema is
 * TypeScript, queries are typed builders that read like SQL, and drizzle-kit owns the
 * migrations. Nothing is generated into src, so there is no codegen step in the build.
 */

const SCHEMA_PATH = "src/schema.ts";

function schemaTs(db: NodeDb): string {
  if (db === "postgres") {
    return `import { index, integer, pgTable, text } from "drizzle-orm/pg-core";

/**
 * The items table. The schema is TypeScript, so the repository's queries are checked
 * against it at compile time: a renamed column is a type error, not a runtime surprise.
 */
export const items = pgTable(
  "items",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    name: text("name").notNull(),
    description: text("description"),
  },
  // Listing sorts and filters on name, and an unindexed column is the first thing to hurt
  // once the table grows.
  (table) => [index("idx_items_name").on(table.name)],
);
`;
  }
  return `import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * The items table. The schema is TypeScript, so the repository's queries are checked
 * against it at compile time: a renamed column is a type error, not a runtime surprise.
 */
export const items = sqliteTable(
  "items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    description: text("description"),
  },
  // Listing sorts and filters on name, and an unindexed column is the first thing to hurt
  // once the table grows.
  (table) => [index("idx_items_name").on(table.name)],
);
`;
}

function repositoryTs(ctx: OrmContext): string {
  const { paths, db } = ctx;
  const dbType =
    db === "postgres"
      ? `import type { NodePgDatabase } from "drizzle-orm/node-postgres";`
      : `import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";`;
  const dbAlias = db === "postgres" ? "NodePgDatabase<typeof schema>" : "BetterSQLite3Database<typeof schema>";

  return `import { asc, count, eq } from "drizzle-orm";
${dbType}
import type { Item, NewItem } from "${rel(paths.ormRepository, paths.entity)}";
import type { ItemsRepository, Page } from "${rel(paths.ormRepository, paths.repository)}";
import * as schema from "${rel(paths.ormRepository, SCHEMA_PATH)}";

const { items } = schema;

type Db = ${dbAlias};

/**
 * Every query against the items table lives here, so "is this query indexed?" is
 * answerable by reading one file.
 */
export class DrizzleItemsRepository implements ItemsRepository {
  constructor(private readonly db: Db) {}

  async add(item: NewItem): Promise<Item> {
    const [row] = await this.db.insert(items).values({ name: item.name, description: item.description }).returning();
    if (row === undefined) {
      throw new Error("insert returned no row");
    }
    return row;
  }

  async find(id: number): Promise<Item | null> {
    const [row] = await this.db.select().from(items).where(eq(items.id, id)).limit(1);
    return row ?? null;
  }

  async page(limit: number, offset: number): Promise<Page> {
    // limit and offset always: never an unbounded read.
    const rows = await this.db.select().from(items).orderBy(asc(items.id)).limit(limit).offset(offset);
    const [totals] = await this.db.select({ total: count() }).from(items);
    return { items: rows, total: totals?.total ?? 0 };
  }
}
`;
}

function dbTs(ctx: OrmContext): string {
  const repo = rel("src/db.ts", ctx.paths.ormRepository);
  if (ctx.db === "postgres") {
    return `import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { Database } from "./database.js";
import { DrizzleItemsRepository } from "${repo}";
import * as schema from "${rel("src/db.ts", SCHEMA_PATH)}";

/**
 * One connection pool for the process. Creating a pool per request is how a service
 * exhausts the database's connection limit.
 */
export async function connect(databaseUrl: string): Promise<Database> {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    // Sized deliberately: a pool larger than the database allows exhausts its connection
    // limit, and one too small queues requests behind each other.
    max: 10,
    // Waiting forever for a connection is how a slow query becomes an outage.
    connectionTimeoutMillis: 5000,
  });
  return {
    repository: new DrizzleItemsRepository(drizzle(pool, { schema })),
    ping: async () => {
      await pool.query("SELECT 1");
    },
    close: () => pool.end(),
  };
}
`;
  }
  return `import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { Database as AppDatabase } from "./database.js";
import { DrizzleItemsRepository } from "${repo}";
import * as schema from "${rel("src/db.ts", SCHEMA_PATH)}";

/** DATABASE_URL uses the "file:" form shared by every ORM here; better-sqlite3 wants the bare path. */
export async function connect(databaseUrl: string): Promise<AppDatabase> {
  const sqlite = new Database(databaseUrl.replace(/^file:/, ""));
  // WAL lets readers and the writer proceed together; SQLite ignores foreign keys unless asked.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return {
    repository: new DrizzleItemsRepository(drizzle(sqlite, { schema })),
    ping: async () => {
      sqlite.prepare("SELECT 1").get();
    },
    close: async () => {
      sqlite.close();
    },
  };
}
`;
}

function configTs(db: NodeDb): string {
  return `// Read by drizzle-kit (generate, migrate, push). The running app does not use this file:
// it connects in src/db.ts.
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "${db === "postgres" ? "postgresql" : "sqlite"}",
  schema: "./src/schema.ts",
  out: "./drizzle",
  // An empty value makes drizzle-kit say the URL is missing, rather than guess one.
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
`;
}

export const drizzlePlugin: OrmPlugin = {
  id: "drizzle",
  label: "Drizzle ORM",

  dependencies: (db) => ({
    "drizzle-orm": V.drizzleOrm,
    ...(db === "postgres" ? { pg: V.pg } : { "better-sqlite3": V.betterSqlite3 }),
  }),
  devDependencies: (db) => ({
    "drizzle-kit": V.drizzleKit,
    dotenv: V.dotenv,
    ...(db === "postgres" ? { "@types/pg": V.typesPg } : { "@types/better-sqlite3": V.typesBetterSqlite3 }),
  }),
  scripts: () => ({
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:push": "drizzle-kit push",
  }),

  gitignore: "\n# Local databases\n*.db\n*.db-journal\n*.db-wal\n*.db-shm\n",

  files: (ctx) => [
    { path: "src/db.ts", content: dbTs(ctx) },
    { path: ctx.paths.ormRepository, content: repositoryTs(ctx) },
    { path: SCHEMA_PATH, content: schemaTs(ctx.db) },
    { path: "drizzle.config.ts", content: configTs(ctx.db) },
  ],

  createSchemaImports: `import { spawnSync } from "node:child_process";`,

  createSchemaSnippet: () => `// drizzle-kit reads DATABASE_URL through drizzle.config.ts, so aim it at the TEST database
  // for this one command. "push" on a fresh database has nothing to confirm.
  const result = spawnSync("npx", ["drizzle-kit", "push"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error("drizzle-kit push failed for the test database");
  }`,

  docker: { buildEnv: () => "", copyBeforeInstall: [], generateStep: "" },

  docs: {
    setupSteps: () => "cp .env.example .env\nnpm run db:push                  # create the schema\n",
    schemaChange: "Edit `src/schema.ts`, run `npm run db:generate`, read the SQL it writes to `drizzle/`, then `npm run db:migrate`. Commit `drizzle/`.",
    sqlLives: 'Drizzle appears only in the repository and `db.ts`. "Is this query indexed?" is answerable from one file.',
    decisions:
      "| **Drizzle on the stable 0.x line** | `drizzle-orm` 0.45 with `drizzle-kit` 0.31. Drizzle 1.0 is still a release candidate, so moving to it is a decision, not a bump. The schema is TypeScript (`src/schema.ts`), so a renamed column is a compile error. |\n",
  },
};
