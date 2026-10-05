import { listFiles } from "../../testing/listFiles.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ScaffoldConfig } from "../../config.js";
import { noopContext } from "../StackAdapter.js";
import { expressAdapter, fastifyAdapter } from "./adapter.js";
import { resolveNodeAddons } from "./addons.js";
import { rel, toPackageName } from "./layout.js";
import { NODE_STRUCTURES } from "./types.js";
import { NODE_VERSIONS } from "./versions.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "buildquick-node-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

type Framework = "express" | "fastify";

async function generate(framework: Framework, addons: Record<string, unknown> = {}, overrides: Partial<ScaffoldConfig> = {}): Promise<string> {
  const outDir = path.join(tmpDir, `${framework}-${Math.random().toString(36).slice(2)}`);
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
      // install is always false: these tests must not shell out or hit the network.
      addons: { structure: "layered", orm: "prisma", db: "sqlite", includeDocker: false, install: false, ...addons },
      ...overrides,
    },
    outDir,
    noopContext
  );
  return outDir;
}

const read = (dir: string, rel: string) => readFileSync(path.join(dir, rel), "utf-8");
const FRAMEWORKS: Framework[] = ["express", "fastify"];

describe("node adapters - file tree", () => {
  it("express + layered + sqlite + docker", async () => {
    expect(listFiles(await generate("express", { includeDocker: true }))).toMatchSnapshot();
  });

  it("fastify + clean + postgres", async () => {
    const files = listFiles(await generate("fastify", { structure: "clean", db: "postgres" }));
    expect(files).toMatchSnapshot();
    expect(files).toContain("src/domain/items-repository.ts");
    expect(files).toContain("src/infrastructure/prisma-items-repository.ts");
  });

  it.each(FRAMEWORKS)("%s with no ORM - routes only, and no prisma files anywhere", async (framework) => {
    const files = listFiles(await generate(framework, { orm: "none" }));
    expect(files.filter((f) => f.toLowerCase().includes("prisma"))).toEqual([]);
    expect(files.filter((f) => f.startsWith("src/items") || f.startsWith("src/domain"))).toEqual([]);
  });
});

describe("node adapters - relative imports resolve to generated files", () => {
  // ESM TypeScript needs every relative import to end in ".js" and to be correct from the
  // importing file. A layout change that misses one template is a compile error.
  it.each(FRAMEWORKS.flatMap((f) => NODE_STRUCTURES.map((s) => [f, s] as const)))(
    "%s / %s: every './x.js' import has a matching .ts file",
    async (framework, structure) => {
      const outDir = await generate(framework, { structure });
      const files = new Set(listFiles(outDir));

      for (const file of [...files].filter((f) => f.endsWith(".ts"))) {
        for (const match of read(outDir, file).matchAll(/from "(\.[^"]+)"/g)) {
          expect(match[1], `${file} imports "${match[1]}" without a .js extension`).toMatch(/\.js$/);
          const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]!.replace(/\.js$/, ".ts")));
          // src/generated is written by `prisma generate` at install time, not by this adapter.
          if (target.startsWith("src/generated/")) continue;
          expect(files.has(target), `${file} imports "${match[1]}" (-> ${target}), which was never generated`).toBe(true);
        }
      }
    }
  );

  it("rel() computes ESM specifiers from the importing file", () => {
    expect(rel("src/items/service.ts", "src/errors.ts")).toBe("../errors.js");
    expect(rel("src/items/service.ts", "src/items/entity.ts")).toBe("./entity.js");
    expect(rel("test/fakes.ts", "src/domain/item.ts")).toBe("../src/domain/item.js");
  });
});

describe("node adapters - the clean structure keeps the domain pure", () => {
  it.each(FRAMEWORKS)("%s: domain/ imports nothing from prisma, zod or the web framework", async (framework) => {
    const outDir = await generate(framework, { structure: "clean" });
    for (const file of listFiles(outDir).filter((f) => f.startsWith("src/domain/"))) {
      const code = read(outDir, file)
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*") && !line.trimStart().startsWith("/*"))
        .join("\n");
      expect(code, `${file} must not depend on a framework`).not.toMatch(/\b(prisma|zod|express|fastify)\b/i);
    }
  });
});

describe("node adapters - the project shape that only a real install revealed", () => {
  it.each(FRAMEWORKS)("%s: ESM with nodenext, an explicit rootDir and types (TypeScript 6 stopped inferring both)", async (framework) => {
    const outDir = await generate(framework);
    const pkg = JSON.parse(read(outDir, "package.json"));
    const tsconfig = JSON.parse(read(outDir, "tsconfig.json"));

    expect(pkg.type).toBe("module");
    expect(tsconfig.compilerOptions.module).toBe("nodenext");
    expect(tsconfig.compilerOptions.rootDir).toBe(".");
    expect(tsconfig.compilerOptions.types).toEqual(["node"]);
    expect(tsconfig.compilerOptions.baseUrl).toBeUndefined();
    expect(JSON.parse(read(outDir, "tsconfig.build.json")).compilerOptions.rootDir).toBe("./src");
    expect(pkg.scripts.start).toBe("node --env-file-if-exists=.env dist/server.js");
  });

  it("pins TypeScript to 6.x, the line Prisma 7's client was verified against - not latest (7.x)", async () => {
    const pkg = JSON.parse(read(await generate("express"), "package.json"));
    expect(pkg.devDependencies.typescript).toBe(NODE_VERSIONS.typescript);
    expect(pkg.devDependencies.typescript).toMatch(/^\^6\./);
  });

  it("declares the Node range vitest 5 needs", async () => {
    expect(JSON.parse(read(await generate("fastify"), "package.json")).engines.node).toBe(NODE_VERSIONS.nodeEngine);
  });

  it("Prisma 7: no url in the schema, the esm prisma-client generator, a prisma.config.ts, and a driver adapter", async () => {
    const outDir = await generate("express");
    const schema = read(outDir, "prisma/schema.prisma")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(schema).not.toMatch(/^\s*url\s*=/m);
    expect(schema).toContain('provider     = "prisma-client"');
    expect(schema).toContain('moduleFormat = "esm"');
    expect(read(outDir, "prisma.config.ts")).toContain('env("DATABASE_URL")');
    expect(read(outDir, "src/db.ts")).toContain("PrismaBetterSqlite3");
    expect(read(outDir, "src/db.ts")).toContain('from "./generated/client.js"');
  });

  it("depends on the Prisma adapter only - it bundles its own driver", async () => {
    const pkg = JSON.parse(read(await generate("express"), "package.json"));
    expect(pkg.dependencies["@prisma/adapter-better-sqlite3"]).toBeDefined();
    expect(pkg.dependencies["better-sqlite3"]).toBeUndefined();
  });

  it("uses the pg adapter for PostgreSQL, with no DATABASE_URL default", async () => {
    const outDir = await generate("express", { db: "postgres" });
    expect(read(outDir, "src/db.ts")).toContain("PrismaPg");
    expect(JSON.parse(read(outDir, "package.json")).dependencies["@prisma/adapter-pg"]).toBeDefined();
    expect(read(outDir, "src/config.ts")).not.toMatch(/DATABASE_URL: z\.string\(\)\.min\(1\)\.default/);
  });

  it("gitignores the generated client and writes a .env so postinstall can run prisma generate", async () => {
    const outDir = await generate("express");
    expect(read(outDir, ".gitignore")).toMatch(/^\/src\/generated$/m);
    expect(read(outDir, ".env")).toContain("DATABASE_URL");
  });
});

describe("node adapters - Express 5 and Fastify 5 specifics", () => {
  it("express: no async wrapper (Express 5 forwards rejections) and req.query is parsed, never assigned", async () => {
    const http = read(await generate("express"), "src/items/http.ts");
    expect(http).not.toMatch(/asyncHandler|express-async-errors/);
    expect(http).toContain("listQuerySchema.parse(req.query)");
    expect(http).not.toMatch(/req\.query\s*=/);
  });

  it("fastify: routes are a plugin registered under the version prefix", async () => {
    const outDir = await generate("fastify");
    expect(read(outDir, "src/items/http.ts")).toContain("export async function itemsRoutes");
    expect(read(outDir, "src/app.ts")).toContain('prefix: "/api/v1"');
  });
});

describe("node adapters - the defaults the scaffold commits to", () => {
  it.each(FRAMEWORKS)("%s: rate limiting and security headers are on, and the probes are exempt from the limiter", async (framework) => {
    const app = read(await generate(framework), "src/app.ts");
    if (framework === "express") {
      expect(app).toContain("rateLimit(");
      expect(app).toContain("helmet()");
      // Registered before the limiter, so a throttled probe cannot report a false outage.
      expect(app.indexOf("/health/ready")).toBeLessThan(app.indexOf("api.use(rateLimit"));
    } else {
      expect(app).toContain("register(rateLimit");
      expect(app).toContain("register(helmet");
      expect(app).toContain("rateLimit: false");
    }
  });

  it.each(FRAMEWORKS)("%s: liveness is outside the version prefix, readiness queries the database and returns 503", async (framework) => {
    const outDir = await generate(framework);
    const app = read(outDir, "src/app.ts");
    expect(app).toContain('"/health"');
    expect(app).toContain("503");
    // The server passes the ORM's ping to the app; the query itself lives in db.ts.
    expect(read(outDir, "src/server.ts")).toContain("database.ping()");
    expect(read(outDir, "src/db.ts")).toContain("SELECT 1");
  });

  it.each(FRAMEWORKS)("%s: validation rejects unknown fields and caps the page size", async (framework) => {
    const schemas = read(await generate(framework), "src/items/schemas.ts");
    expect(schemas).toContain("z.strictObject");
    expect(schemas).toContain("MAX_LIMIT = 200");
    expect(schemas).toContain(".max(MAX_LIMIT)");
  });

  it.each(FRAMEWORKS)("%s: config is validated at startup and shuts down gracefully", async (framework) => {
    const outDir = await generate(framework);
    expect(read(outDir, "src/config.ts")).toContain("Invalid configuration");
    expect(read(outDir, "src/server.ts")).toMatch(/SIGTERM/);
  });

  it.each(FRAMEWORKS)("%s: internal errors are logged, never returned", async (framework) => {
    expect(read(await generate(framework), "src/app.ts")).toContain("internal server error");
  });

  it("repository tests use a dedicated database and never --force-reset", async () => {
    const outDir = await generate("express");
    const setup = read(outDir, "test/global-setup.ts");
    expect(setup).toContain("TEST_DATABASE_URL");
    expect(
      setup
        .split("\n")
        .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
        .join("\n")
    ).not.toContain("--force-reset");
    expect(read(outDir, "test/repository.test.ts")).not.toContain("process.env.DATABASE_URL");
  });

  it("PostgreSQL repository tests skip without TEST_DATABASE_URL instead of failing", async () => {
    expect(read(await generate("express", { db: "postgres" }), "test/global-setup.ts")).toContain("return undefined");
  });

  it("omits tests when includeTests is false", async () => {
    expect(listFiles(await generate("express", {}, { includeTests: false })).filter((f) => f.startsWith("test/") || f === "vitest.config.ts")).toEqual([]);
  });
});

describe("node adapters - Dockerfile (not built here: Docker was not running)", () => {
  it("sets a build-stage placeholder DATABASE_URL, because npm ci runs prisma generate before any env exists", async () => {
    const dockerfile = read(await generate("express", { includeDocker: true }), "Dockerfile");
    const [builder, runtime] = dockerfile.split("AS runtime");
    expect(builder).toContain('ENV DATABASE_URL="file:./build-only.db"');
    // Builder only: the runtime image must still require a real one. Instructions only -
    // a comment there says "DATABASE_URL must be provided", so it names the variable.
    const runtimeInstructions = runtime!
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n");
    expect(runtimeInstructions).not.toContain("DATABASE_URL");
  });

  it("copies prisma.config.ts into the builder, where generate needs it", async () => {
    expect(read(await generate("express", { includeDocker: true }), "Dockerfile")).toContain("COPY prisma.config.ts");
  });

  it("prunes in the builder and copies node_modules across, so native modules survive", async () => {
    const instructions = read(await generate("fastify", { includeDocker: true }), "Dockerfile")
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n");
    expect(instructions).toContain("npm prune --omit=dev");
    expect(instructions).toContain("COPY --from=builder /app/node_modules ./node_modules");
    // Neither would work: postinstall needs the dev-only prisma CLI, and --ignore-scripts
    // skips the SQLite driver's native build.
    expect(instructions).not.toMatch(/npm ci --omit=dev/);
  });

  it("runs as a non-root user with a health check", async () => {
    const dockerfile = read(await generate("express", { includeDocker: true }), "Dockerfile");
    expect(dockerfile).toContain("USER node");
    expect(dockerfile).toContain("HEALTHCHECK");
  });
});

describe("resolveNodeAddons", () => {
  it("defaults to layered + prisma + sqlite, and does not install unless asked", () => {
    expect(resolveNodeAddons({}, "express")).toEqual({ structure: "layered", orm: "prisma", db: "sqlite", includeDocker: false, install: false });
  });

  it.each(["prisma", "drizzle", "typeorm", "sequelize", "none"])("accepts %s, because a plug-in is registered for it", (orm) => {
    expect(resolveNodeAddons({ orm }, "fastify")).toMatchObject({ orm });
  });

  it("lists every generatable ORM in its error, derived from the registry so it cannot drift", () => {
    expect(() => resolveNodeAddons({ orm: "mongoose" }, "express")).toThrow(/none, prisma, drizzle, typeorm, sequelize/);
  });

  it("rejects an unknown structure, ORM or database by name", () => {
    expect(() => resolveNodeAddons({ structure: "onion" }, "express")).toThrow(/Invalid express structure 'onion'/);
    expect(() => resolveNodeAddons({ orm: "mongoose" }, "express")).toThrow(/Invalid ORM 'mongoose'/);
    expect(() => resolveNodeAddons({ db: "mysql" }, "express")).toThrow(/Invalid database 'mysql'/);
  });
});

describe("package naming", () => {
  it("turns a CamelCase project name into a valid npm package name", () => {
    expect(toPackageName("ItemsApi")).toBe("items-api");
    expect(toPackageName("My_Service2")).toBe("my-service2");
  });
});
