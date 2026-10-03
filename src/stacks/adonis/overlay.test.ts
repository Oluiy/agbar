import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFile } from "../../utils/fsWrite.js";
import { adonisAdapter } from "./adapter.js";
import { applyOverlay } from "./overlay.js";
import { ITEMS_MIGRATION } from "./templates.js";

/**
 * The overlay runs against the official starter kit, which these tests cannot download.
 * So they reproduce the exact kit lines the overlay anchors on (copied from a real
 * `npm create adonisjs -- --kit=api` + `node ace add @adonisjs/limiter`), and check the
 * patching logic - including that it fails loudly when the kit changes. The full overlay
 * was verified against the real kit: typecheck, 7 Japa tests, and a live server.
 */
let dir: string;

function seedKit(): void {
  writeFile(path.join(dir, "start/routes.ts"), "import router from '@adonisjs/core/services/router'\n\nrouter.get('/', () => ({ hello: 'world' }))\n");
  writeFile(
    path.join(dir, "start/env.ts"),
    "export default await Env.create(new URL('../', import.meta.url), {\n  LIMITER_STORE: Env.schema.enum(['database', 'memory'] as const)\n})\n"
  );
  writeFile(path.join(dir, "config/database.ts"), "connection: {\n  filename: app.tmpPath('db.sqlite3'),\n},\n");
  writeFile(path.join(dir, "tests/bootstrap.ts"), "export const runnerHooks = {\n  setup: [],\n  teardown: [],\n}\n");
  writeFile(path.join(dir, ".env"), "APP_KEY=secret\n");
  writeFile(path.join(dir, ".env.example"), "APP_KEY=\n");
  writeFile(path.join(dir, ".env.test"), "SESSION_DRIVER=memory\n");
}

const read = (rel: string) => readFileSync(path.join(dir, rel), "utf-8");

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "buildquick-adonis-"));
  seedKit();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("applyOverlay", () => {
  it("keeps the kit's own routes and appends buildquick's, rate limited, with probes outside the limiter", () => {
    applyOverlay(dir, "Api", true);
    const routes = read("start/routes.ts");
    expect(routes.startsWith("import router from '@adonisjs/core/services/router'")).toBe(true);
    expect(routes).toContain("router.get('/', () => ({ hello: 'world' }))");
    expect(routes).toContain(".use(throttle)");
    expect(routes.indexOf("'/health'")).toBeLessThan(routes.indexOf(".use(throttle)"));
  });

  it("points tests at their own SQLite file, never the development database", () => {
    applyOverlay(dir, "Api", true);
    expect(read("config/database.ts")).toContain("app.tmpPath(app.inTest ? 'test.sqlite3' : 'db.sqlite3')");
  });

  it("declares RATE_LIMIT_REQUESTS in the env schema and documents it in .env and .env.example", () => {
    applyOverlay(dir, "Api", true);
    expect(read("start/env.ts")).toContain("RATE_LIMIT_REQUESTS: Env.schema.number.optional()");
    expect(read(".env")).toContain("RATE_LIMIT_REQUESTS=100");
    expect(read(".env.example")).toContain("RATE_LIMIT_REQUESTS=100");
    expect(read("start/limiter.ts")).toContain("env.get('RATE_LIMIT_REQUESTS', 100)");
  });

  it("tests use the in-memory limiter, migrate first, and reset the limiter between tests", () => {
    applyOverlay(dir, "Api", true);
    expect(read(".env.test")).toContain("LIMITER_STORE=memory");
    expect(read("tests/bootstrap.ts")).toContain("setup: [() => testUtils.db().migrate()]");
    const spec = read("tests/functional/items.spec.ts");
    expect(spec).toContain("withGlobalTransaction");
    expect(spec).toContain("limiter.clear()");
  });

  it("caps the page size in the validator and paginates every list", () => {
    applyOverlay(dir, "Api", true);
    expect(read("app/validators/item.ts")).toContain("MAX_PER_PAGE = 200");
    expect(read("app/controllers/items_controller.ts")).toContain(".paginate(page, perPage)");
    expect(read(ITEMS_MIGRATION)).toContain("async down()");
  });

  it("writes no test files when tests are off", () => {
    applyOverlay(dir, "Api", false);
    expect(read(".env.test")).not.toContain("LIMITER_STORE");
    expect(() => read("tests/functional/items.spec.ts")).toThrow();
  });

  it("fails loudly, naming the file, when the kit no longer has a line it patches", () => {
    writeFileSync(path.join(dir, "config/database.ts"), "connection: { filename: 'elsewhere' },\n");
    expect(() => applyOverlay(dir, "Api", true)).toThrow(/starter kit changed: .* config\/database\.ts/);
  });
});

describe("adonisAdapter", () => {
  it("does not install or run tests unless asked", () => {
    expect(adonisAdapter.resolveAddons({})).toEqual({ install: false });
  });

  it("refuses an existing destination instead of scaffolding into it", async () => {
    await expect(
      adonisAdapter.generate(
        {
          projectName: "Api",
          outputDirectory: dir,
          includeTests: true,
          isMicroservice: false,
          serviceNames: [],
          httpPort: 3333,
          usesLlmApi: false,
          addons: { install: false },
        },
        dir
      )
    ).rejects.toThrow(/Node 24|already exists/);
  });
});
