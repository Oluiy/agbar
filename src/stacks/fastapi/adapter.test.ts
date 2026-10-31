import { listFiles } from "../../testing/listFiles.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ScaffoldConfig } from "../../config.js";
import { noopContext } from "../StackAdapter.js";
import { fastapiAdapter } from "./adapter.js";
import { resolveFastApiAddons } from "./addons.js";
import { pathsFor } from "./layout.js";
import { FASTAPI_STRUCTURES } from "./types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "agbar-fastapi-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function baseConfig(addons: Record<string, unknown>, overrides: Partial<ScaffoldConfig> = {}): ScaffoldConfig {
  return {
    projectName: "ItemsApi",
    outputDirectory: tmpDir,
    includeTests: true,
    isMicroservice: false,
    serviceNames: [],
    httpPort: 8000,
    usesLlmApi: false,
    // install is always false here: these tests must not shell out or hit the network.
    addons: { structure: "layered", db: "sqlite", includeDocker: false, install: false, ...addons },
    ...overrides,
  };
}

async function generate(addons: Record<string, unknown>, overrides: Partial<ScaffoldConfig> = {}): Promise<string> {
  const outDir = path.join(tmpDir, "out");
  await fastapiAdapter.generate(baseConfig(addons, overrides), outDir, noopContext);
  return outDir;
}

describe("fastapiAdapter.generate - file tree", () => {
  it("layered + sqlite + docker + tests", async () => {
    expect(listFiles(await generate({ includeDocker: true }))).toMatchSnapshot();
  });

  it("modular by feature + postgres", async () => {
    expect(listFiles(await generate({ structure: "modular", db: "postgres" }))).toMatchSnapshot();
  });

  it("clean + sqlite - adds the domain entity and the repository protocol", async () => {
    expect(listFiles(await generate({ structure: "clean" }))).toMatchSnapshot();
  });

  it("no database - routes only, and no empty model/repository packages", async () => {
    const files = listFiles(await generate({ db: "none" }));
    expect(files).toMatchSnapshot();
    // An app/models/ holding nothing but __init__.py is a worse starting point
    // than no folder at all.
    expect(files.filter((f) => /^app\/(models|repositories|schemas|services|db)\//.test(f))).toEqual([]);
  });
});

describe("fastapiAdapter.generate - imports resolve to generated files", () => {
  // Python couples import path to file location, so a layout change that misses a
  // template turns into an ImportError at runtime. This checks every generated
  // "from app.x.y import" against the files actually written.
  it.each(FASTAPI_STRUCTURES)("every app.* import in %s exists on disk", async (structure) => {
    const outDir = await generate({ structure });
    const files = new Set(listFiles(outDir));

    for (const file of [...files].filter((f) => f.endsWith(".py"))) {
      const text = readFileSync(path.join(outDir, file), "utf-8");
      for (const match of text.matchAll(/^from (app[\w.]*) import/gm)) {
        const asFile = `${match[1].replace(/\./g, "/")}.py`;
        const asPackage = `${match[1].replace(/\./g, "/")}/__init__.py`;
        expect(files.has(asFile) || files.has(asPackage), `${file} imports ${match[1]}, which was never generated`).toBe(true);
      }
    }
  });

  it("the paths table and the templates agree on where main.py lives", () => {
    for (const structure of FASTAPI_STRUCTURES) {
      expect(pathsFor(structure).mainFile).toBe("app/main.py");
    }
  });
});

describe("fastapiAdapter.generate - the defaults the scaffold commits to", () => {
  it("never writes a real credential, and gitignores .env", async () => {
    const outDir = await generate({ db: "postgres" });
    const gitignore = readFileSync(path.join(outDir, ".gitignore"), "utf-8");
    expect(gitignore).toMatch(/^\.env$/m);

    // The example file documents the shape; the placeholder must be obviously fake.
    const envExample = readFileSync(path.join(outDir, ".env.example"), "utf-8");
    expect(envExample).toContain("CHANGE_ME");
  });

  it("lists items through a capped, paginated route rather than SELECT *", async () => {
    const outDir = await generate({});
    const route = readFileSync(path.join(outDir, "app/api/routes/items.py"), "utf-8");
    expect(route).toContain("le=200");
    expect(route).toContain("offset");

    const repo = readFileSync(path.join(outDir, "app/repositories/item_repository.py"), "utf-8");
    expect(repo).toContain(".limit(limit)");
  });

  it("separates liveness from readiness, and readiness touches the database", async () => {
    const outDir = await generate({});
    expect(readFileSync(path.join(outDir, "app/main.py"), "utf-8")).toContain('@app.get("/health"');
    const health = readFileSync(path.join(outDir, "app/api/routes/health.py"), "utf-8");
    expect(health).toContain("SELECT 1");
    expect(health).toContain("503");
  });

  it("ships a migration that can be applied immediately, and reversed", async () => {
    const outDir = await generate({});
    const migration = readFileSync(path.join(outDir, "migrations/versions/0001_create_items.py"), "utf-8");
    expect(migration).toContain('op.create_table(\n        "items"');
    expect(migration).toContain("def downgrade()");
    expect(migration).toContain("op.drop_table");
  });

  it("declares dependencies as lower bounds, so a generated project is not born stale", async () => {
    const pyproject = readFileSync(path.join(await generate({}), "pyproject.toml"), "utf-8");
    // fastapi[standard] brings FastAPI's own CLI (`fastapi dev` / `fastapi run`)
    // along with uvicorn, so the project uses the framework's command, not a
    // hand-rolled uvicorn invocation.
    expect(pyproject).toContain("fastapi[standard]>=");
    expect(pyproject).not.toMatch(/fastapi(\[standard\])?==/);
  });

  it("omits tests when includeTests is false", async () => {
    const files = listFiles(await generate({}, { includeTests: false }));
    expect(files.filter((f) => f.startsWith("tests/"))).toEqual([]);
  });
});

describe("resolveFastApiAddons", () => {
  it("defaults to layered + sqlite, and does not install unless asked", () => {
    expect(resolveFastApiAddons({})).toEqual({ structure: "layered", db: "sqlite", includeDocker: false, install: false });
  });

  it("rejects an unknown structure or database by name", () => {
    expect(() => resolveFastApiAddons({ structure: "onion" })).toThrow(/Invalid FastAPI structure 'onion'/);
    expect(() => resolveFastApiAddons({ db: "mongo" })).toThrow(/Invalid database 'mongo'/);
  });
});
