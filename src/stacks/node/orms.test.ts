import { listFiles } from "../../testing/listFiles.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { noopContext } from "../StackAdapter.js";
import { expressAdapter, fastifyAdapter } from "./adapter.js";
import { implementedOrms, ormMenuOptions, ormPlugin } from "./orms/index.js";
import { NODE_VERSIONS } from "./versions.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "buildquick-orms-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

async function generate(orm: string, addons: Record<string, unknown> = {}, framework: "express" | "fastify" = "express"): Promise<string> {
  const outDir = path.join(tmpDir, `${orm}-${Math.random().toString(36).slice(2)}`);
  const adapter = framework === "express" ? expressAdapter : fastifyAdapter;
  await adapter.generate(
    {
      projectName: "ItemsApi",
      outputDirectory: tmpDir,
      includeTests: true,
      isMicroservice: false,
      serviceNames: [],
      httpPort: 3000,
      usesLlmApi: false,
      addons: { structure: "layered", orm, db: "sqlite", includeDocker: true, install: false, ...addons },
    },
    outDir,
    noopContext
  );
  return outDir;
}

const read = (dir: string, rel: string) => readFileSync(path.join(dir, rel), "utf-8");
const ORMS = ["prisma", "drizzle", "typeorm", "sequelize"] as const;
const STRUCTURES = ["layered", "clean"] as const;

/** Code only: drops comment lines, which deliberately name the things the code avoids. */
const code = (text: string) =>
  text
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
    .join("\n");

describe("the interactive ORM menu", () => {
  it("offers every ORM that can be generated - it cannot lag the registry", () => {
    expect(
      ormMenuOptions()
        .map((o) => o.value)
        .sort()
    ).toEqual([...implementedOrms()].sort());
    expect(ormMenuOptions().map((o) => o.value)).toEqual(expect.arrayContaining(["prisma", "drizzle", "typeorm", "sequelize", "none"]));
  });
});

describe("the ORM registry", () => {
  it("has a plug-in for every ORM it claims to generate, and none for 'none'", () => {
    expect(implementedOrms().sort()).toEqual(["drizzle", "none", "prisma", "sequelize", "typeorm"]);
    expect(ormPlugin("none")).toBeUndefined();
    for (const orm of ORMS) expect(ormPlugin(orm)?.id).toBe(orm);
  });
});

describe("every ORM generates the same project shape behind one Database interface", () => {
  it.each(ORMS)("%s: tree snapshot (express, layered, sqlite)", async (orm) => {
    expect(listFiles(await generate(orm))).toMatchSnapshot();
  });

  it.each(ORMS.flatMap((o) => STRUCTURES.map((s) => [o, s] as const)))("%s / %s: every './x.js' import has a matching .ts file", async (orm, structure) => {
    const outDir = await generate(orm, { structure });
    const files = new Set(listFiles(outDir));
    for (const file of [...files].filter((f) => f.endsWith(".ts"))) {
      for (const match of read(outDir, file).matchAll(/from "(\.[^"]+)"/g)) {
        expect(match[1], `${file} imports "${match[1]}" without a .js extension`).toMatch(/\.js$/);
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]!.replace(/\.js$/, ".ts")));
        if (target.startsWith("src/generated/")) continue; // written by `prisma generate`
        expect(files.has(target), `${file} imports "${match[1]}" (-> ${target}), which was never generated`).toBe(true);
      }
    }
  });

  it.each(ORMS)("%s: db.ts exports connect() returning the shared Database, and the server never names the ORM", async (orm) => {
    const outDir = await generate(orm);
    expect(read(outDir, "src/db.ts")).toMatch(/export async function connect\(databaseUrl: string\): Promise<(App)?Database>/);
    expect(read(outDir, "src/database.ts")).toContain("close(): Promise<void>");
    const server = read(outDir, "src/server.ts");
    expect(server).toContain("await connect(config.databaseUrl)");
    expect(server).toContain("database.close()");
    expect(server).not.toMatch(new RegExp(orm, "i"));
  });

  it.each(ORMS)("%s: the repository implementation is named after the ORM, in the layered and clean places", async (orm) => {
    expect(listFiles(await generate(orm))).toContain(`src/items/${orm}-repository.ts`);
    expect(listFiles(await generate(orm, { structure: "clean" }))).toContain(`src/infrastructure/${orm}-items-repository.ts`);
  });

  it.each(ORMS)("%s: repository tests use the shared interface and the dedicated test database", async (orm) => {
    const outDir = await generate(orm);
    const setup = read(outDir, "test/global-setup.ts");
    expect(setup).toContain("TEST_DATABASE_URL");
    // Never reset, drop or sync: a test run must not be able to destroy a real database.
    expect(code(setup)).not.toMatch(/--force-reset|dropDatabase|dropSchema|synchronize|DROP /i);
    expect(code(setup)).not.toContain("process.env.DATABASE_URL");
    expect(read(outDir, "test/repository.test.ts")).toContain("database.repository");
  });

  it.each(ORMS)("%s: gitignores local databases", async (orm) => {
    expect(read(await generate(orm), ".gitignore")).toMatch(/^\*\.db$/m);
  });
});

describe("each ORM brings the right driver for the database, and only that one", () => {
  it.each([
    ["drizzle", "better-sqlite3", "pg"],
    ["typeorm", "better-sqlite3", "pg"],
    ["sequelize", "sqlite3", "pg"],
  ] as const)("%s: sqlite gets %s, postgres gets %s - never both", async (orm, sqliteDriver, pgDriver) => {
    const sqlite = JSON.parse(read(await generate(orm, { db: "sqlite" }), "package.json")).dependencies;
    expect(sqlite[sqliteDriver]).toBeDefined();
    expect(sqlite[pgDriver]).toBeUndefined();

    const postgres = JSON.parse(read(await generate(orm, { db: "postgres" }), "package.json")).dependencies;
    expect(postgres[pgDriver]).toBeDefined();
    expect(postgres[sqliteDriver]).toBeUndefined();
  });

  it("prisma depends on its adapter only, because the adapter bundles the driver", async () => {
    const deps = JSON.parse(read(await generate("prisma"), "package.json")).dependencies;
    expect(deps["@prisma/adapter-better-sqlite3"]).toBeDefined();
    expect(deps["better-sqlite3"]).toBeUndefined();
  });

  it("pins better-sqlite3 to the verified major (12), not the untested 13", () => {
    expect(NODE_VERSIONS.betterSqlite3).toMatch(/^\^12\./);
  });
});

describe("Drizzle", () => {
  it("is the stable 0.x line with its paired drizzle-kit, not the 1.0 release candidate", () => {
    expect(NODE_VERSIONS.drizzleOrm).toMatch(/^\^0\.45/);
    expect(NODE_VERSIONS.drizzleKit).toMatch(/^\^0\.31/);
  });

  it("has a TypeScript schema, a config that reads DATABASE_URL, and generate/migrate/push scripts", async () => {
    const outDir = await generate("drizzle");
    expect(read(outDir, "src/schema.ts")).toContain("sqliteTable");
    expect(read(outDir, "drizzle.config.ts")).toContain("process.env.DATABASE_URL");
    const scripts = JSON.parse(read(outDir, "package.json")).scripts;
    expect(scripts["db:generate"]).toBe("drizzle-kit generate");
    expect(scripts["db:push"]).toBe("drizzle-kit push");
    expect(read(outDir, "test/global-setup.ts")).toContain("drizzle-kit");
  });

  it("uses pgTable and node-postgres for PostgreSQL", async () => {
    const outDir = await generate("drizzle", { db: "postgres" });
    expect(read(outDir, "src/schema.ts")).toContain("pgTable");
    expect(read(outDir, "src/db.ts")).toContain("drizzle-orm/node-postgres");
    expect(read(outDir, "src/db.ts")).toContain("connectionTimeoutMillis");
  });

  it("limits every list query", async () => {
    const repo = read(await generate("drizzle"), "src/items/drizzle-repository.ts");
    expect(repo).toContain(".limit(limit).offset(offset)");
  });
});

describe("TypeORM", () => {
  it("defines the entity with EntitySchema, never decorators - esbuild (vitest) does not implement emitDecoratorMetadata", async () => {
    const outDir = await generate("typeorm");
    const all = listFiles(outDir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => code(read(outDir, f)))
      .join("\n");
    expect(read(outDir, "src/item.schema.ts")).toContain("new EntitySchema");
    expect(all).not.toMatch(/@(Entity|Column|PrimaryGeneratedColumn)\b/);
    expect(read(outDir, "tsconfig.json")).not.toContain("emitDecoratorMetadata");
  });

  it("never lets the ORM rewrite the schema: synchronize is off and a real migration ships", async () => {
    const outDir = await generate("typeorm");
    expect(read(outDir, "src/data-source.ts")).toContain("synchronize: false");
    expect(read(outDir, "src/migrations/1700000000000-create-items.ts")).toContain("async down(");
    expect(read(outDir, "test/global-setup.ts")).toContain("migrate(url)");
  });

  it("db:migrate runs the migrator directly, and importing it does not", async () => {
    const outDir = await generate("typeorm");
    expect(JSON.parse(read(outDir, "package.json")).scripts["db:migrate"]).toContain("src/migrate.ts");
    expect(read(outDir, "src/migrate.ts")).toContain("import.meta.url === pathToFileURL(process.argv[1]).href");
  });

  it("sets WAL for SQLite and a bounded pool for PostgreSQL", async () => {
    expect(read(await generate("typeorm"), "src/data-source.ts")).toContain("enableWAL: true");
    const pg = read(await generate("typeorm", { db: "postgres" }), "src/data-source.ts");
    expect(pg).toContain("poolSize: 10");
    expect(pg).toContain("connectTimeoutMS");
  });
});

describe("Sequelize", () => {
  it("is the stable 6.x line (v7 is alpha), with umzug for migrations", () => {
    expect(NODE_VERSIONS.sequelize).toMatch(/^\^6\./);
    expect(NODE_VERSIONS.umzug).toMatch(/^\^3\./);
  });

  it("declares every model attribute with `declare`, or class fields shadow Sequelize's getters", async () => {
    const model = read(await generate("sequelize"), "src/item.model.ts");
    for (const attr of ["id", "name", "description"]) expect(model).toMatch(new RegExp(`declare ${attr}:`));
    expect(model).toContain("timestamps: false");
  });

  it("runs migrations through umzug, and ships a reversible one", async () => {
    const outDir = await generate("sequelize");
    expect(read(outDir, "src/migrator.ts")).toContain("new Umzug");
    expect(read(outDir, "src/migrations/001-create-items.ts")).toContain("async down(");
    expect(read(outDir, "test/global-setup.ts")).toContain("migrate(url)");
  });

  it("PostgreSQL gets pg-hstore and a bounded pool", async () => {
    const outDir = await generate("sequelize", { db: "postgres" });
    expect(JSON.parse(read(outDir, "package.json")).dependencies["pg-hstore"]).toBeDefined();
    expect(read(outDir, "src/migrator.ts")).toContain("pool: { max: 10, acquire: 5000 }");
  });
});

describe("Dockerfiles for ORMs with no codegen step", () => {
  it.each(["drizzle", "typeorm", "sequelize"])("%s: no Prisma generate, no placeholder DATABASE_URL, still prunes and runs as non-root", async (orm) => {
    const dockerfile = read(await generate(orm), "Dockerfile");
    const instructions = dockerfile
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n");
    expect(instructions).not.toMatch(/prisma/i);
    expect(instructions).not.toContain("ENV DATABASE_URL");
    expect(instructions).toContain("npm prune --omit=dev");
    expect(instructions).toContain("USER node");
  });
});

describe("the same HTTP layer works on both frameworks for every ORM", () => {
  it.each(ORMS)("%s on fastify generates without touching the web framework's files", async (orm) => {
    const outDir = await generate(orm, {}, "fastify");
    expect(read(outDir, "src/app.ts")).toContain("@fastify/helmet");
    expect(read(outDir, "src/db.ts")).toContain("connect");
  });
});
