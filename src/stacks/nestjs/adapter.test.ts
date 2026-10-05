import { listFiles } from "../../testing/listFiles.js";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ScaffoldConfig } from "../../config.js";
import { noopContext } from "../StackAdapter.js";
import { nestjsAdapter } from "./adapter.js";
import { resolveNestAddons } from "./addons.js";
import { NEST_VERSIONS } from "./versions.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "buildquick-nestjs-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

async function generate(addons: Record<string, unknown> = {}, overrides: Partial<ScaffoldConfig> = {}): Promise<string> {
  const outDir = path.join(tmpDir, "out");
  await nestjsAdapter.generate(
    {
      projectName: "NestApi",
      outputDirectory: tmpDir,
      includeTests: true,
      isMicroservice: false,
      serviceNames: [],
      httpPort: 3000,
      usesLlmApi: false,
      // install is always false: these tests must not shell out or hit the network.
      addons: { structure: "modular", orm: "prisma", db: "sqlite", includeDocker: false, install: false, ...addons },
      ...overrides,
    },
    outDir,
    noopContext
  );
  return outDir;
}

describe("nestjsAdapter.generate - file tree", () => {
  it("modular + prisma + docker + tests", async () => {
    expect(listFiles(await generate({ includeDocker: true }))).toMatchSnapshot();
  });

  it("clean + prisma - adds the domain entity and the repository port", async () => {
    const files = listFiles(await generate({ structure: "clean" }));
    expect(files).toMatchSnapshot();
    expect(files).toContain("src/modules/items/domain/item.entity.ts");
    expect(files).toContain("src/modules/items/domain/items.repository.port.ts");
  });

  it("no orm - routes only, and no prisma files anywhere", async () => {
    const files = listFiles(await generate({ orm: "none" }));
    expect(files.filter((f) => f.toLowerCase().includes("prisma"))).toEqual([]);
    expect(files.filter((f) => f.includes("modules/items"))).toEqual([]);
  });
});

describe("nestjsAdapter.generate - relative imports resolve to generated files", () => {
  // TypeScript relative imports break silently in a template when a file moves
  // between structures; this walks every generated import and checks the target.
  it.each(["modular", "clean"])("every relative import in %s exists on disk", async (structure) => {
    const outDir = await generate({ structure });
    const files = listFiles(outDir);

    for (const file of files.filter((f) => f.endsWith(".ts"))) {
      const text = readFileSync(path.join(outDir, file), "utf-8");
      for (const match of text.matchAll(/from "(\.[^"]+)"/g)) {
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
        // src/generated is written by `prisma generate` at install time (Prisma 7's
        // "prisma-client" generator emits into the source tree), not by this adapter.
        if (resolved.startsWith("src/generated/")) continue;
        const exists = existsSync(path.join(outDir, `${resolved}.ts`)) || existsSync(path.join(outDir, resolved, "index.ts"));
        expect(exists, `${file} imports "${match[1]}" (-> ${resolved}.ts), which was never generated`).toBe(true);
      }
    }
  });
});

describe("nestjsAdapter.generate - the version choices that keep it installable", () => {
  it("pins TypeScript to the only version both peers allow: >=6 (schematics) and <7 (ts-jest)", async () => {
    // This exact pin is what makes `npm install` succeed. 5.x fails ERESOLVE
    // against @nestjs/schematics, 7.x fails against ts-jest.
    const pkg = JSON.parse(readFileSync(path.join(await generate(), "package.json"), "utf-8"));
    expect(pkg.devDependencies.typescript).toBe(NEST_VERSIONS.typescript);
    expect(pkg.devDependencies.typescript).toMatch(/^\^6\./);
  });

  it("keeps the prisma CLI and client on the same major", async () => {
    const pkg = JSON.parse(readFileSync(path.join(await generate(), "package.json"), "utf-8"));
    const major = (range: string) => range.replace(/^\^/, "").split(".")[0];
    expect(major(pkg.dependencies["@prisma/client"])).toBe(major(pkg.devDependencies.prisma));
  });

  it("enables the two compiler options Nest's DI depends on", async () => {
    const tsconfig = JSON.parse(readFileSync(path.join(await generate(), "tsconfig.json"), "utf-8"));
    expect(tsconfig.compilerOptions.emitDecoratorMetadata).toBe(true);
    expect(tsconfig.compilerOptions.experimentalDecorators).toBe(true);
    expect(tsconfig.compilerOptions.strict).toBe(true);
  });
});

describe("nestjsAdapter.generate - the defaults the scaffold commits to", () => {
  it("wires rate limiting globally, not per-controller", async () => {
    const appModule = readFileSync(path.join(await generate(), "src/app.module.ts"), "utf-8");
    expect(appModule).toContain("ThrottlerModule");
    expect(appModule).toContain("APP_GUARD");
  });

  it("rejects unknown fields instead of ignoring them", async () => {
    const main = readFileSync(path.join(await generate(), "src/main.ts"), "utf-8");
    expect(main).toContain("forbidNonWhitelisted: true");
    expect(main).toContain("enableShutdownHooks");
  });

  it("keeps /health outside the version prefix so probes do not move", async () => {
    const main = readFileSync(path.join(await generate(), "src/main.ts"), "utf-8");
    expect(main).toContain('exclude: ["health"]');
  });

  it("caps the page size in the DTO, where validation enforces it", async () => {
    const dto = readFileSync(path.join(await generate(), "src/modules/items/dto/item.dto.ts"), "utf-8");
    expect(dto).toContain("@Max(200)");
  });

  it("gitignores .env while still writing one, because the prisma CLI needs it", async () => {
    const outDir = await generate();
    expect(readFileSync(path.join(outDir, ".gitignore"), "utf-8")).toMatch(/^\.env$/m);
    expect(existsSync(path.join(outDir, ".env"))).toBe(true);
    expect(readFileSync(path.join(outDir, ".env"), "utf-8")).not.toMatch(/password|secret/i);
  });

  it("omits tests when includeTests is false", async () => {
    const files = listFiles(await generate({}, { includeTests: false }));
    expect(files.filter((f) => f.includes(".spec.ts"))).toEqual([]);
  });
});

describe("nestjsAdapter.generate - NestJS 12 and Prisma 7 breaking changes (each found only by installing)", () => {
  it("compiles as nodenext with an explicit rootDir and types - NestJS 12 is ESM-only and TypeScript 6 stopped inferring both", async () => {
    const tsconfig = JSON.parse(readFileSync(path.join(await generate(), "tsconfig.json"), "utf-8"));
    expect(tsconfig.compilerOptions.module).toBe("nodenext");
    expect(tsconfig.compilerOptions.moduleResolution).toBe("nodenext");
    // TS5011: TypeScript 6 no longer infers a common source directory.
    expect(tsconfig.compilerOptions.rootDir).toBe(".");
    // TS 6 stopped auto-including @types/*, so "describe" is undefined without this.
    expect(tsconfig.compilerOptions.types).toEqual(["node", "jest"]);
    // TS5101: baseUrl is a hard error in TypeScript 6.
    expect(tsconfig.compilerOptions.baseUrl).toBeUndefined();
  });

  it("narrows rootDir to src in the build config so start:prod finds dist/main.js", async () => {
    const outDir = await generate();
    const build = JSON.parse(readFileSync(path.join(outDir, "tsconfig.build.json"), "utf-8"));
    expect(build.compilerOptions.rootDir).toBe("./src");
    expect(JSON.parse(readFileSync(path.join(outDir, "package.json"), "utf-8")).scripts["start:prod"]).toBe("node dist/main");
  });

  it("runs Jest through --experimental-vm-modules, because plain jest cannot load an ES module", async () => {
    const scripts = JSON.parse(readFileSync(path.join(await generate(), "package.json"), "utf-8")).scripts;
    for (const name of ["test", "test:watch", "test:cov", "test:e2e"]) {
      expect(scripts[name], `${name} must use the ESM-aware runner`).toContain("--experimental-vm-modules");
    }
  });

  it("maps .js imports back to .ts in both Jest configs - Prisma 7's client imports './internal/class.js' under nodenext", async () => {
    const outDir = await generate();
    const unit = JSON.parse(readFileSync(path.join(outDir, "package.json"), "utf-8")).jest;
    const e2e = JSON.parse(readFileSync(path.join(outDir, "jest-e2e.json"), "utf-8"));
    for (const config of [unit, e2e]) {
      expect(config.moduleNameMapper["^(\\.{1,2}/.*)\\.js$"]).toBe("$1");
    }
  });

  it("declares the Node range NestJS 12 requires", async () => {
    const pkg = JSON.parse(readFileSync(path.join(await generate(), "package.json"), "utf-8"));
    expect(pkg.engines.node).toBe(NEST_VERSIONS.nodeEngine);
    expect(pkg.engines.node).toContain("22.22.3");
  });

  it("keeps the nest CLI, which is how a Nest project is built and extended", async () => {
    const pkg = JSON.parse(readFileSync(path.join(await generate(), "package.json"), "utf-8"));
    expect(pkg.devDependencies["@nestjs/cli"]).toBeDefined();
    expect(pkg.scripts.build).toBe("nest build");
  });

  it("Prisma 7: no url in the schema, the prisma-client generator with a cjs output, and a prisma.config.ts", async () => {
    const outDir = await generate();
    const schema = readFileSync(path.join(outDir, "prisma/schema.prisma"), "utf-8");
    const code = schema
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    // Prisma 7 rejects `url` in schema.prisma outright (P1012).
    expect(code).not.toMatch(/^\s*url\s*=/m);
    expect(code).toContain('provider     = "prisma-client"');
    expect(code).not.toContain("prisma-client-js");
    expect(code).toContain('moduleFormat = "cjs"');
    const config = readFileSync(path.join(outDir, "prisma.config.ts"), "utf-8");
    expect(config).toContain('env("DATABASE_URL")');
    expect(config).toContain("defineConfig");
  });

  it("Prisma 7: PrismaClient is built with a driver adapter, imported from the generated client", async () => {
    const service = readFileSync(path.join(await generate(), "src/prisma/prisma.service.ts"), "utf-8");
    expect(service).toContain("PrismaBetterSqlite3");
    expect(service).toContain('from "../generated/client"');
    expect(service).not.toContain('from "@prisma/client"');
  });

  it("uses the pg adapter for PostgreSQL", async () => {
    const outDir = await generate({ db: "postgres" });
    expect(readFileSync(path.join(outDir, "src/prisma/prisma.service.ts"), "utf-8")).toContain("PrismaPg");
    expect(JSON.parse(readFileSync(path.join(outDir, "package.json"), "utf-8")).dependencies["@prisma/adapter-pg"]).toBeDefined();
  });

  it("depends on the adapter only - it bundles its own driver, and a second copy installs two native builds", async () => {
    const pkg = JSON.parse(readFileSync(path.join(await generate(), "package.json"), "utf-8"));
    expect(pkg.dependencies["@prisma/adapter-better-sqlite3"]).toBeDefined();
    expect(pkg.dependencies["better-sqlite3"]).toBeUndefined();
    expect(pkg.dependencies.pg).toBeUndefined();
  });

  it("gitignores the generated client, which postinstall rebuilds", async () => {
    expect(readFileSync(path.join(await generate(), ".gitignore"), "utf-8")).toMatch(/^\/src\/generated$/m);
  });

  it("the Dockerfile (not built here: Docker was not running) gives the builder a placeholder DATABASE_URL, copies prisma.config.ts, and prunes instead of re-running npm ci", async () => {
    const dockerfile = readFileSync(path.join(await generate({ includeDocker: true }), "Dockerfile"), "utf-8");
    const [builder, runtime] = dockerfile.split("AS runtime");
    // npm ci runs prisma generate (postinstall) before any environment exists.
    expect(builder).toContain('ENV DATABASE_URL="file:./build-only.db"');
    expect(runtime).not.toContain("DATABASE_URL");
    expect(builder).toContain("COPY prisma.config.ts");
    const instructions = dockerfile
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    expect(instructions).toContain("npm prune --omit=dev");
    expect(instructions).not.toMatch(/npm ci --omit=dev/);
    // NestJS 12 needs Node 22.22.3+, so a floating node:22-alpine is not acceptable.
    // trixie, not bookworm: prebuilt native modules need a glibc newer than bookworm's 2.36.
    expect(dockerfile).toContain("FROM node:24-trixie-slim");
    expect(dockerfile).not.toMatch(/FROM node:24-slim/);
  });

  it("the Dockerfile no longer copies node_modules/.prisma, which Prisma 7 does not create", async () => {
    // Instructions only: a comment explains why the copy is gone, so it names the path.
    const instructions = readFileSync(path.join(await generate({ includeDocker: true }), "Dockerfile"), "utf-8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    expect(instructions).not.toContain("node_modules/.prisma");
  });
});

describe("resolveNestAddons", () => {
  it("defaults to modular + prisma + sqlite, and neither shells out nor installs unless asked", () => {
    // useCli and install both default to false here on purpose: a --yes/--config
    // run should stay offline and deterministic. The interactive flow recommends
    // the CLI instead.
    expect(resolveNestAddons({})).toEqual({ structure: "modular", orm: "prisma", db: "sqlite", includeDocker: false, useCli: false, install: false });
  });

  it("accepts useCli when a scripted run opts in", () => {
    expect(resolveNestAddons({ useCli: true })).toMatchObject({ useCli: true });
  });

  it("rejects an unimplemented ORM by name rather than generating broken imports", () => {
    expect(() => resolveNestAddons({ orm: "typeorm" })).toThrow(/isn't generatable yet/);
  });

  it("rejects an unknown structure, ORM or database", () => {
    expect(() => resolveNestAddons({ structure: "onion" })).toThrow(/Invalid NestJS structure 'onion'/);
    expect(() => resolveNestAddons({ orm: "mongoose" })).toThrow(/Invalid ORM 'mongoose'/);
    expect(() => resolveNestAddons({ db: "mysql" })).toThrow(/Invalid database 'mysql'/);
  });
});
