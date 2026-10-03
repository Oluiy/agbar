import { listFiles } from "../../testing/listFiles.js";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ScaffoldConfig } from "../../config.js";
import { axumAdapter } from "./adapter.js";
import { resolveAxumAddons } from "./addons.js";
import { toKebab, toSnake } from "./layout.js";
import { AXUM_STRUCTURES } from "./types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "buildquick-axum-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

async function generate(addons: Record<string, unknown> = {}, overrides: Partial<ScaffoldConfig> = {}): Promise<string> {
  const outDir = path.join(tmpDir, "out");
  await axumAdapter.generate(
    {
      projectName: "ItemsApi",
      outputDirectory: tmpDir,
      includeTests: true,
      isMicroservice: false,
      serviceNames: [],
      httpPort: 3000,
      usesLlmApi: false,
      // useCli and install are always false: these tests must not shell out.
      addons: { structure: "layered", db: "sqlite", includeDocker: false, useCli: false, install: false, ...addons },
      ...overrides,
    },
    outDir
  );
  return outDir;
}

const read = (dir: string, rel: string) => readFileSync(path.join(dir, rel), "utf-8");

describe("axumAdapter.generate - file tree", () => {
  it("layered + sqlite + docker", async () => {
    expect(listFiles(await generate({ includeDocker: true }))).toMatchSnapshot();
  });

  it("clean + postgres - splits domain, application, infrastructure and api", async () => {
    const files = listFiles(await generate({ structure: "clean", db: "postgres" }));
    expect(files).toMatchSnapshot();
    expect(files).toContain("src/domain/repository.rs");
    expect(files).toContain("src/infrastructure/sqlx_repository.rs");
  });
});

describe("axumAdapter.generate - module paths resolve to generated files", () => {
  // Rust couples a file's location to the path other files `use` it by, so a layout
  // change that misses one template is a compile error. This checks every
  // `use crate::...` against the files actually written.
  it.each(AXUM_STRUCTURES)("every `use crate::` path in %s points at a real module", async (structure) => {
    const outDir = await generate({ structure });
    const files = new Set(listFiles(outDir));

    for (const file of [...files].filter((f) => f.endsWith(".rs"))) {
      for (const match of read(outDir, file).matchAll(/\bcrate::([A-Za-z0-9_]+(?:::[a-z0-9_]+)*)/g)) {
        const segments = match[1].split("::");
        // The tail may be an item (crate::db::DbPool), so accept the longest prefix that is a module file.
        const resolved = segments.some((_, i) => {
          const base = `src/${segments.slice(0, segments.length - i).join("/")}`;
          return files.has(`${base}.rs`) || files.has(`${base}/mod.rs`);
        });
        expect(resolved, `${file} uses crate::${match[1]}, which was never generated`).toBe(true);
      }
    }
  });

  it("every module declared by a mod.rs or lib.rs has a file", async () => {
    for (const structure of AXUM_STRUCTURES) {
      const outDir = path.join(tmpDir, structure);
      await axumAdapter.generate(
        {
          projectName: "ItemsApi",
          outputDirectory: tmpDir,
          includeTests: true,
          isMicroservice: false,
          serviceNames: [],
          httpPort: 3000,
          usesLlmApi: false,
          addons: { structure, db: "sqlite", includeDocker: false, useCli: false, install: false },
        },
        outDir
      );
      const files = new Set(listFiles(outDir));
      for (const file of [...files].filter((f) => f.endsWith("mod.rs") || f === "src/lib.rs")) {
        const dir = path.posix.dirname(file);
        for (const m of read(outDir, file).matchAll(/^pub mod (\w+);/gm)) {
          expect(files.has(`${dir}/${m[1]}.rs`) || files.has(`${dir}/${m[1]}/mod.rs`), `${file} declares mod ${m[1]} with no file`).toBe(true);
        }
      }
    }
  });
});

describe("axumAdapter.generate - the clean structure keeps the domain pure", () => {
  it("domain/ imports nothing from sqlx, serde or axum", async () => {
    const outDir = await generate({ structure: "clean" });
    for (const file of listFiles(outDir).filter((f) => f.startsWith("src/domain/") && f.endsWith(".rs"))) {
      // Code only: the doc comments *explain* that the domain avoids these crates, so
      // they name them on purpose.
      const code = read(outDir, file)
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("//"))
        .join("\n");
      expect(code, `${file} must not depend on a framework`).not.toMatch(/\b(sqlx|serde|axum)\b/);
    }
  });

  it("the sqlx row type and the JSON response type live outside the domain", async () => {
    const outDir = await generate({ structure: "clean" });
    expect(read(outDir, "src/infrastructure/sqlx_repository.rs")).toContain("struct ItemRow");
    expect(read(outDir, "src/api/handlers.rs")).toContain("struct ItemResponse");
  });

  it("the layered entity derives serde and sqlx directly - that is the point of the layered structure", async () => {
    const entity = read(await generate(), "src/items/entity.rs");
    expect(entity).toContain("Serialize");
    expect(entity).toContain("sqlx::FromRow");
  });
});

describe("axumAdapter.generate - the database dialect", () => {
  it("sqlite uses ? placeholders and an INTEGER AUTOINCREMENT key", async () => {
    const outDir = await generate({ db: "sqlite" });
    expect(read(outDir, "src/items/sqlx_repository.rs")).toContain("VALUES (?, ?)");
    expect(read(outDir, "migrations/0001_create_items.sql")).toContain("INTEGER PRIMARY KEY AUTOINCREMENT");
  });

  it("postgres uses $n placeholders and BIGSERIAL", async () => {
    const outDir = await generate({ db: "postgres" });
    expect(read(outDir, "src/items/sqlx_repository.rs")).toContain("VALUES ($1, $2)");
    expect(read(outDir, "migrations/0001_create_items.sql")).toContain("BIGSERIAL PRIMARY KEY");
    expect(read(outDir, "src/db.rs")).toContain("PgPoolOptions");
  });

  it("postgres has no database_url default, and its HTTP tests are ignored until a server is configured", async () => {
    const outDir = await generate({ db: "postgres" });
    expect(read(outDir, "src/config.rs")).toContain("DATABASE_URL is required");
    expect(read(outDir, "tests/api.rs")).toContain("#[ignore");
  });

  it("sqlite tests run by default against an in-memory database with one connection", async () => {
    const tests = read(await generate({ db: "sqlite" }), "tests/api.rs");
    expect(tests).not.toContain("#[ignore");
    expect(tests).toContain("max_connections(1)");
  });
});

describe("axumAdapter.generate - the defaults the scaffold commits to", () => {
  it("queries bind parameters and never build SQL with format!", async () => {
    const repo = read(await generate(), "src/items/sqlx_repository.rs");
    expect(repo).toContain(".bind(");
    expect(repo).not.toMatch(/format!\(\s*"[^"]*(SELECT|INSERT)/);
  });

  it("caps pagination in the handler and always applies LIMIT", async () => {
    const outDir = await generate();
    expect(read(outDir, "src/items/handlers.rs")).toContain("MAX_LIMIT: i64 = 200");
    expect(read(outDir, "src/items/sqlx_repository.rs")).toContain("LIMIT");
  });

  it("rate limits per client, with a timeout and a body limit, applied to the whole router", async () => {
    const mw = read(await generate(), "src/middleware.rs");
    expect(mw).toContain("GovernorLayer");
    expect(mw).toContain("TimeoutLayer");
    expect(mw).toContain("RequestBodyLimitLayer");
  });

  it("separates liveness (no database) from readiness (queries it, 503 on failure)", async () => {
    const health = read(await generate(), "src/health.rs");
    expect(health).toContain("SELECT 1");
    expect(health).toContain("SERVICE_UNAVAILABLE");
  });

  it("shuts down gracefully, and never returns an internal error's detail to the client", async () => {
    const outDir = await generate();
    expect(read(outDir, "src/main.rs")).toContain("with_graceful_shutdown");
    expect(read(outDir, "src/error.rs")).toContain("internal server error");
  });

  it("embeds migrations in the binary", async () => {
    expect(read(await generate(), "src/db.rs")).toContain('sqlx::migrate!("./migrations")');
  });

  it("the fallback Cargo.toml uses caret majors, never exact pins", async () => {
    const cargo = read(await generate(), "Cargo.toml");
    expect(cargo).toContain('axum = "0.8"');
    expect(cargo).not.toMatch(/=\s*"=/);
    expect(cargo).toContain("default-features = false");
  });

  it("gitignores target/ and .env, and the example password is a placeholder", async () => {
    const outDir = await generate({ db: "postgres" });
    expect(read(outDir, ".gitignore")).toMatch(/^\/target$/m);
    expect(read(outDir, ".gitignore")).toMatch(/^\.env$/m);
    expect(read(outDir, ".env.example")).toContain("CHANGE_ME");
  });

  it("builds a two-stage non-root image with a health check", async () => {
    const dockerfile = read(await generate({ includeDocker: true }), "Dockerfile");
    expect(dockerfile).toMatch(/FROM rust:.* AS builder/);
    expect(dockerfile).toContain("USER appuser");
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain("/target/release/items-api");
  });

  it("omits tests when includeTests is false", async () => {
    expect(existsSync(path.join(await generate({}, { includeTests: false }), "tests/api.rs"))).toBe(false);
  });
});

describe("crate naming", () => {
  it("turns a CamelCase project name into the kebab package and snake crate cargo expects", () => {
    expect(toKebab("ItemsApi")).toBe("items-api");
    expect(toSnake("ItemsApi")).toBe("items_api");
    expect(toSnake("My_Service2")).toBe("my_service2");
  });

  it("main.rs and the tests import the snake_case crate name", async () => {
    const outDir = await generate();
    expect(read(outDir, "src/main.rs")).toContain("use items_api::");
    expect(read(outDir, "tests/api.rs")).toContain("use items_api::");
  });
});

describe("resolveAxumAddons", () => {
  it("defaults to layered + sqlite, and neither shells out nor builds unless asked", () => {
    expect(resolveAxumAddons({})).toEqual({ structure: "layered", db: "sqlite", includeDocker: false, useCli: false, install: false });
  });

  it("rejects an unknown structure or database by name", () => {
    expect(() => resolveAxumAddons({ structure: "onion" })).toThrow(/Invalid Axum structure 'onion'/);
    expect(() => resolveAxumAddons({ db: "mongo" })).toThrow(/Invalid database 'mongo'/);
  });
});
