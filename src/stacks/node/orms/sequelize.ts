import { rel } from "../layout.js";
import { NODE_VERSIONS as V } from "../versions.js";
import type { NodeDb } from "../types.js";
import type { OrmContext, OrmPlugin } from "./types.js";

/**
 * Sequelize 6 (the stable line; v7 is still alpha) with umzug for migrations.
 *
 * Migrations run programmatically through umzug rather than through sequelize-cli: the CLI
 * is a CommonJS tool that wants a .sequelizerc and a folder of .cjs files, which fights an
 * ESM TypeScript project. umzug is the same engine sequelize-cli uses underneath, and the
 * migrations here are ordinary typed modules the tests run for real.
 */

const MODEL_PATH = "src/item.model.ts";
const MIGRATION_PATH = "src/migrations/001-create-items.ts";
const MIGRATOR_PATH = "src/migrator.ts";

function modelTs(): string {
  return `import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes, type Sequelize } from "sequelize";

/**
 * The items table. \`declare\` on every attribute is required, not style: without it the
 * class fields emitted by a modern target would shadow Sequelize's getters and every
 * attribute would read as undefined.
 */
export class ItemModel extends Model<InferAttributes<ItemModel>, InferCreationAttributes<ItemModel>> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare description: string | null;
}

/** Binds the model to a connection. Called once, from db.ts and the migrator's callers. */
export function initItemModel(sequelize: Sequelize): typeof ItemModel {
  ItemModel.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.TEXT, allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      sequelize,
      tableName: "items",
      // No createdAt/updatedAt columns: the migration does not create them.
      timestamps: false,
    },
  );
  return ItemModel;
}
`;
}

function migrationTs(): string {
  return `import { DataTypes, type QueryInterface } from "sequelize";

/**
 * The first migration. Every later change is a new numbered file in this folder, added to
 * the list in migrator.ts. Written out (not generated) so a fresh clone has a schema to
 * apply immediately.
 */
export const createItems = {
  name: "001-create-items",

  async up({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
    await queryInterface.createTable("items", {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      name: { type: DataTypes.TEXT, allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
    });
    // Listing sorts and filters on name, and an unindexed column is the first thing to hurt
    // once the table grows.
    await queryInterface.addIndex("items", ["name"], { name: "idx_items_name" });
  },

  /** Reversible on purpose: a migration you cannot roll back is a one-way door. */
  async down({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
    await queryInterface.dropTable("items");
  },
};
`;
}

function connectionTs(db: NodeDb): string {
  const options =
    db === "postgres"
      ? `new Sequelize(databaseUrl, {
    dialect: "postgres",
    logging: false,
    // Sized deliberately: a pool larger than the database allows exhausts its connection
    // limit, and one too small queues requests behind each other.
    pool: { max: 10, acquire: 5000 },
  })`
      : `new Sequelize({
    dialect: "sqlite",
    // DATABASE_URL uses the "file:" form shared by every ORM here; the driver wants the bare path.
    storage: databaseUrl.replace(/^file:/, ""),
    logging: false,
  })`;
  return options;
}

function migratorTs(db: NodeDb): string {
  return `import { pathToFileURL } from "node:url";
import { Sequelize } from "sequelize";
import { SequelizeStorage, Umzug } from "umzug";
import { loadConfig } from "./config.js";
import { createItems } from "${rel(MIGRATOR_PATH, MIGRATION_PATH)}";

/** The one place a Sequelize connection is configured. */
export function createSequelize(databaseUrl: string): Sequelize {
  return ${connectionTs(db)};
}

/** Every migration, in order. A new one is added to the end of this list. */
const migrations = [createItems];

/** Applies every pending migration to the database at \`databaseUrl\`, then disconnects. */
export async function migrate(databaseUrl: string): Promise<void> {
  const sequelize = createSequelize(databaseUrl);
  try {
    const umzug = new Umzug({
      migrations,
      context: sequelize.getQueryInterface(),
      // Applied migrations are recorded in the SequelizeMeta table.
      storage: new SequelizeStorage({ sequelize }),
      logger: undefined,
    });
    await umzug.up();
  } finally {
    await sequelize.close();
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
import { initItemModel } from "${rel("src/db.ts", MODEL_PATH)}";
import { createSequelize } from "${rel("src/db.ts", MIGRATOR_PATH)}";
import { SequelizeItemsRepository } from "${rel("src/db.ts", ctx.paths.ormRepository)}";

/**
 * One Sequelize instance (and so one connection pool) for the process. Creating a
 * connection per request is how a service exhausts the database's connections.
 */
export async function connect(databaseUrl: string): Promise<Database> {
  const sequelize = createSequelize(databaseUrl);
  // Fails here, at start-up, if the database cannot be reached.
  await sequelize.authenticate();
  const model = initItemModel(sequelize);
  return {
    repository: new SequelizeItemsRepository(model),
    ping: async () => {
      await sequelize.query("SELECT 1");
    },
    close: () => sequelize.close(),
  };
}
`;
}

function repositoryTs(ctx: OrmContext): string {
  const { paths } = ctx;
  return `import type { Item, NewItem } from "${rel(paths.ormRepository, paths.entity)}";
import type { ItemsRepository, Page } from "${rel(paths.ormRepository, paths.repository)}";
import type { ItemModel } from "${rel(paths.ormRepository, MODEL_PATH)}";

/** Maps the model instance to the feature's Item: the one place that knows its shape. */
function toItem(row: ItemModel): Item {
  return { id: row.id, name: row.name, description: row.description };
}

/**
 * Every query against the items table lives here, so "is this query indexed?" is
 * answerable by reading one file.
 */
export class SequelizeItemsRepository implements ItemsRepository {
  constructor(private readonly model: typeof ItemModel) {}

  async add(item: NewItem): Promise<Item> {
    return toItem(await this.model.create({ name: item.name, description: item.description }));
  }

  async find(id: number): Promise<Item | null> {
    const row = await this.model.findByPk(id);
    return row === null ? null : toItem(row);
  }

  async page(limit: number, offset: number): Promise<Page> {
    // limit and offset always: never an unbounded read.
    const { rows, count } = await this.model.findAndCountAll({ order: [["id", "ASC"]], limit, offset });
    return { items: rows.map(toItem), total: count };
  }
}
`;
}

export const sequelizePlugin: OrmPlugin = {
  id: "sequelize",
  label: "Sequelize 6",

  dependencies: (db) => ({
    sequelize: V.sequelize,
    umzug: V.umzug,
    ...(db === "postgres" ? { pg: V.pg, "pg-hstore": V.pgHstore } : { sqlite3: V.sqlite3 }),
  }),
  devDependencies: (db): Record<string, string> => (db === "postgres" ? { "@types/pg": V.typesPg } : {}),
  scripts: () => ({
    "db:migrate": "tsx --env-file-if-exists=.env src/migrator.ts",
  }),

  gitignore: "\n# Local databases\n*.db\n*.db-journal\n*.db-wal\n*.db-shm\n",

  files: (ctx) => [
    { path: "src/db.ts", content: dbTs(ctx) },
    { path: ctx.paths.ormRepository, content: repositoryTs(ctx) },
    { path: MODEL_PATH, content: modelTs() },
    { path: MIGRATION_PATH, content: migrationTs() },
    { path: MIGRATOR_PATH, content: migratorTs(ctx.db) },
  ],

  createSchemaImports: "",

  createSchemaSnippet: () => `// Run the project's own migrations - not a schema sync - so the test database gets exactly
  // what production would, and a broken migration fails the suite instead of shipping.
  const { migrate } = await import("../src/migrator.js");
  await migrate(url);`,

  docker: { buildEnv: () => "", copyBeforeInstall: [], generateStep: "" },

  docs: {
    setupSteps: () => "cp .env.example .env\nnpm run db:migrate                # apply the migrations\n",
    schemaChange:
      "Add a numbered migration under `src/migrations/` and append it to the list in `src/migrator.ts`, then `npm run db:migrate`. Never edit one that has been applied.",
    sqlLives: 'Sequelize appears only in the repository, `db.ts`, the model and the migrator. "Is this query indexed?" is answerable from one file.',
    decisions:
      "| **Sequelize 6 and umzug** | v6 is the stable line (v7 is still alpha). Migrations run through umzug, the engine sequelize-cli uses underneath, because the CLI is CommonJS and wants a `.sequelizerc` and `.cjs` files - awkward in an ESM TypeScript project. |\n| **Model attributes use `declare`** | Without it, class fields emitted by a modern target shadow Sequelize's getters and every attribute reads as `undefined`. |\n",
  },
};
