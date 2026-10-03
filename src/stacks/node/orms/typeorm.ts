import { rel } from "../layout.js";
import { NODE_VERSIONS as V } from "../versions.js";
import type { NodeDb } from "../types.js";
import type { OrmContext, OrmPlugin } from "./types.js";

/**
 * TypeORM 1.x with EntitySchema instead of decorated classes.
 *
 * Why not decorators: they need `emitDecoratorMetadata`, which esbuild (vitest's compiler)
 * does not implement, so a decorated entity compiles but loses its column types at run
 * time. EntitySchema is plain objects - no compiler feature involved - and describes the
 * same table. The schema is created by a real migration class, run programmatically, so
 * the tests exercise exactly what production would.
 */

const ENTITY_PATH = "src/item.schema.ts";
const DATA_SOURCE_PATH = "src/data-source.ts";
const MIGRATION_PATH = "src/migrations/1700000000000-create-items.ts";

function entityTs(): string {
  return `import { EntitySchema } from "typeorm";

/** The table's row shape. Private to this ORM: the rest of the project sees \`Item\`. */
export interface ItemRow {
  id: number;
  name: string;
  description: string | null;
}

/**
 * The items table, as plain data. No decorators, so nothing depends on
 * emitDecoratorMetadata - which esbuild (vitest) does not implement.
 */
export const ItemSchema = new EntitySchema<ItemRow>({
  name: "Item",
  tableName: "items",
  columns: {
    id: { type: "integer", primary: true, generated: "increment" },
    name: { type: "text" },
    description: { type: "text", nullable: true },
  },
  // Listing sorts and filters on name, and an unindexed column is the first thing to hurt
  // once the table grows.
  indices: [{ name: "idx_items_name", columns: ["name"] }],
});
`;
}

function migrationTs(): string {
  return `import { Table, TableIndex, type MigrationInterface, type QueryRunner } from "typeorm";

/**
 * The first migration. Every later change is a new numbered file here, applied in order
 * and recorded in the "migrations" table. Written out (not generated) so a fresh clone
 * has a schema to apply immediately.
 */
export class CreateItems1700000000000 implements MigrationInterface {
  name = "CreateItems1700000000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "items",
        columns: [
          { name: "id", type: "integer", isPrimary: true, isGenerated: true, generationStrategy: "increment" },
          { name: "name", type: "text", isNullable: false },
          { name: "description", type: "text", isNullable: true },
        ],
      }),
    );
    await queryRunner.createIndex("items", new TableIndex({ name: "idx_items_name", columnNames: ["name"] }));
  }

  /** Reversible on purpose: a migration you cannot roll back is a one-way door. */
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex("items", "idx_items_name");
    await queryRunner.dropTable("items");
  }
}
`;
}

function dataSourceTs(db: NodeDb): string {
  const options =
    db === "postgres"
      ? `    type: "postgres",
    url: databaseUrl,
    // Sized deliberately: a pool larger than the database allows exhausts its connection
    // limit, and one too small queues requests behind each other.
    poolSize: 10,
    // Waiting forever for a connection is how a slow query becomes an outage.
    connectTimeoutMS: 5000,`
      : `    type: "better-sqlite3",
    // DATABASE_URL uses the "file:" form shared by every ORM here; the driver wants the bare path.
    database: databaseUrl.replace(/^file:/, ""),
    // WAL lets readers and the writer proceed together.
    enableWAL: true,`;

  return `import { DataSource } from "typeorm";
import { ItemSchema } from "${rel(DATA_SOURCE_PATH, ENTITY_PATH)}";
import { CreateItems1700000000000 } from "${rel(DATA_SOURCE_PATH, MIGRATION_PATH)}";

/**
 * The one place a DataSource is configured. \`synchronize\` is off: letting the ORM rewrite
 * the schema to match the entities at start-up is how a deploy drops a column. The schema
 * changes only through migrations.
 */
export function createDataSource(databaseUrl: string): DataSource {
  return new DataSource({
${options}
    entities: [ItemSchema],
    migrations: [CreateItems1700000000000],
    synchronize: false,
  });
}
`;
}

function migrateTs(): string {
  return `import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { createDataSource } from "${rel("src/migrate.ts", DATA_SOURCE_PATH)}";

/** Applies every pending migration to the database at \`databaseUrl\`, then disconnects. */
export async function migrate(databaseUrl: string): Promise<void> {
  const dataSource = createDataSource(databaseUrl);
  await dataSource.initialize();
  try {
    await dataSource.runMigrations();
  } finally {
    await dataSource.destroy();
  }
}

// \`npm run db:migrate\` runs this file directly; importing it (the tests do) does not.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await migrate(loadConfig().databaseUrl);
  console.log("migrations applied");
}
`;
}

function dbTs(ctx: OrmContext): string {
  return `import type { Database } from "./database.js";
import { createDataSource } from "${rel("src/db.ts", DATA_SOURCE_PATH)}";
import { TypeormItemsRepository } from "${rel("src/db.ts", ctx.paths.ormRepository)}";
import { ItemSchema } from "${rel("src/db.ts", ENTITY_PATH)}";

/**
 * One DataSource (and so one connection pool) for the process. Creating a connection per
 * request is how a service exhausts the database's connections.
 */
export async function connect(databaseUrl: string): Promise<Database> {
  const dataSource = createDataSource(databaseUrl);
  await dataSource.initialize();
  return {
    repository: new TypeormItemsRepository(dataSource.getRepository(ItemSchema)),
    ping: async () => {
      await dataSource.query("SELECT 1");
    },
    close: () => dataSource.destroy(),
  };
}
`;
}

function repositoryTs(ctx: OrmContext): string {
  const { paths } = ctx;
  return `import type { Repository } from "typeorm";
import type { Item, NewItem } from "${rel(paths.ormRepository, paths.entity)}";
import type { ItemsRepository, Page } from "${rel(paths.ormRepository, paths.repository)}";
import type { ItemRow } from "${rel(paths.ormRepository, ENTITY_PATH)}";

/** Maps the table row to the feature's Item: the one place that knows the row's shape. */
function toItem(row: ItemRow): Item {
  return { id: row.id, name: row.name, description: row.description };
}

/**
 * Every query against the items table lives here, so "is this query indexed?" is
 * answerable by reading one file.
 */
export class TypeormItemsRepository implements ItemsRepository {
  constructor(private readonly repository: Repository<ItemRow>) {}

  async add(item: NewItem): Promise<Item> {
    const saved = await this.repository.save({ name: item.name, description: item.description });
    return toItem(saved);
  }

  async find(id: number): Promise<Item | null> {
    const row = await this.repository.findOneBy({ id });
    return row === null ? null : toItem(row);
  }

  async page(limit: number, offset: number): Promise<Page> {
    // take and skip always: never an unbounded read.
    const [rows, total] = await this.repository.findAndCount({ order: { id: "ASC" }, take: limit, skip: offset });
    return { items: rows.map(toItem), total };
  }
}
`;
}

export const typeormPlugin: OrmPlugin = {
  id: "typeorm",
  label: "TypeORM",

  dependencies: (db) => ({
    typeorm: V.typeorm,
    ...(db === "postgres" ? { pg: V.pg } : { "better-sqlite3": V.betterSqlite3 }),
  }),
  devDependencies: (db): Record<string, string> => (db === "postgres" ? { "@types/pg": V.typesPg } : { "@types/better-sqlite3": V.typesBetterSqlite3 }),
  scripts: () => ({
    "db:migrate": "tsx --env-file-if-exists=.env src/migrate.ts",
  }),

  gitignore: "\n# Local databases\n*.db\n*.db-journal\n*.db-wal\n*.db-shm\n",

  files: (ctx) => [
    { path: "src/db.ts", content: dbTs(ctx) },
    { path: ctx.paths.ormRepository, content: repositoryTs(ctx) },
    { path: ENTITY_PATH, content: entityTs() },
    { path: DATA_SOURCE_PATH, content: dataSourceTs(ctx.db) },
    { path: MIGRATION_PATH, content: migrationTs() },
    { path: "src/migrate.ts", content: migrateTs() },
  ],

  createSchemaImports: "",

  createSchemaSnippet: () => `// Run the project's own migration - not a schema sync - so the test database gets exactly
  // what production would, and a broken migration fails the suite instead of shipping.
  const { migrate } = await import("../src/migrate.js");
  await migrate(url);`,

  docker: { buildEnv: () => "", copyBeforeInstall: [], generateStep: "" },

  docs: {
    setupSteps: () => "cp .env.example .env\nnpm run db:migrate                # apply the migrations\n",
    schemaChange:
      "Add a numbered migration class under `src/migrations/` and register it in `src/data-source.ts`, then `npm run db:migrate`. Never edit one that has been applied.",
    sqlLives: 'TypeORM appears only in the repository, `db.ts` and the data source. "Is this query indexed?" is answerable from one file.',
    decisions:
      "| **TypeORM with `EntitySchema`, not decorators** | Decorators need `emitDecoratorMetadata`, which esbuild (vitest's compiler) does not implement, so a decorated entity compiles but loses its column types at run time. `EntitySchema` describes the same table as plain data. |\n| **`synchronize` is off; the schema changes by migration** | Letting the ORM rewrite the schema to match the entities at start-up is how a deploy drops a column. The tests run the real migration, so a broken one fails the suite. |\n",
  },
};
