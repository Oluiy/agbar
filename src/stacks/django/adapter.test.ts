import { listFiles } from "../../testing/listFiles.js";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ScaffoldConfig } from "../../config.js";
import { djangoAdapter } from "./adapter.js";
import { resolveDjangoAddons } from "./addons.js";
import { DJANGO_STRUCTURES } from "./types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "buildquick-django-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

async function generate(addons: Record<string, unknown> = {}, overrides: Partial<ScaffoldConfig> = {}): Promise<string> {
  const outDir = path.join(tmpDir, "out");
  await djangoAdapter.generate(
    {
      projectName: "DjApi",
      outputDirectory: tmpDir,
      includeTests: true,
      isMicroservice: false,
      serviceNames: [],
      httpPort: 8000,
      usesLlmApi: false,
      // useCli and install are always false: these tests must not shell out.
      addons: { structure: "standard", db: "sqlite", includeDocker: false, useCli: false, install: false, ...addons },
      ...overrides,
    },
    outDir
  );
  return outDir;
}

describe("djangoAdapter.generate - file tree", () => {
  it("standard + sqlite + docker", async () => {
    expect(listFiles(await generate({ includeDocker: true }))).toMatchSnapshot();
  });

  it("service-layer + postgres - adds services.py and selectors.py", async () => {
    const files = listFiles(await generate({ structure: "service-layer", db: "postgres" }));
    expect(files).toMatchSnapshot();
    expect(files).toContain("apps/items/services.py");
    expect(files).toContain("apps/items/selectors.py");
  });

  it("standard has no services or selectors", async () => {
    const files = listFiles(await generate());
    expect(files).not.toContain("apps/items/services.py");
    expect(files).not.toContain("apps/items/selectors.py");
  });
});

describe("djangoAdapter.generate - imports resolve to generated files", () => {
  // Python couples import path to file location, so a missed template turns into an
  // ImportError at runtime. Checks every "from apps.x import" and relative import.
  it.each(DJANGO_STRUCTURES)("every project import in %s exists on disk", async (structure) => {
    const outDir = await generate({ structure });
    const files = new Set(listFiles(outDir));

    for (const file of [...files].filter((f) => f.endsWith(".py"))) {
      const text = readFileSync(path.join(outDir, file), "utf-8");
      for (const match of text.matchAll(/^from (apps[\w.]*|config[\w.]*) import/gm)) {
        const asFile = `${match[1].replace(/\./g, "/")}.py`;
        const asPackage = `${match[1].replace(/\./g, "/")}/__init__.py`;
        expect(files.has(asFile) || files.has(asPackage), `${file} imports ${match[1]}, which was never generated`).toBe(true);
      }
      for (const match of text.matchAll(/^from \.(\w+) import/gm)) {
        const sibling = path.posix.join(path.posix.dirname(file), `${match[1]}.py`);
        expect(files.has(sibling), `${file} imports .${match[1]}, which was never generated`).toBe(true);
      }
    }
  });

  it("the services and selectors modules are only imported by the structure that generates them", async () => {
    const outDir = await generate();
    const views = readFileSync(path.join(outDir, "apps/items/views.py"), "utf-8");
    expect(views).not.toMatch(/import .*(services|selectors)/);
  });
});

describe("djangoAdapter.generate - the defaults the scaffold commits to", () => {
  it("never hardcodes a SECRET_KEY, and fails at startup when none is set", async () => {
    const settings = readFileSync(path.join(await generate(), "config/settings.py"), "utf-8");
    expect(settings).toContain("ImproperlyConfigured");
    expect(settings).toContain('os.environ.get("DJANGO_SECRET_KEY"');
    // The only literal key is the dev-only one, reachable solely with DEBUG on.
    expect(settings).toContain("dev-only-insecure-key");
  });

  it("keeps DEBUG off by default - only manage.py turns it on, so a deployed server cannot", async () => {
    const outDir = await generate();
    expect(readFileSync(path.join(outDir, "config/settings.py"), "utf-8")).toContain('"DJANGO_DEBUG", "false"');
    expect(readFileSync(path.join(outDir, "manage.py"), "utf-8")).toContain('setdefault("DJANGO_DEBUG", "true")');
    expect(readFileSync(path.join(outDir, "config/wsgi.py"), "utf-8")).not.toContain("DJANGO_DEBUG");
  });

  it("caps pagination in one place and turns rate limiting on globally", async () => {
    const outDir = await generate();
    expect(readFileSync(path.join(outDir, "apps/core/pagination.py"), "utf-8")).toContain("max_limit = 200");
    const settings = readFileSync(path.join(outDir, "config/settings.py"), "utf-8");
    expect(settings).toContain("DEFAULT_THROTTLE_CLASSES");
    expect(settings).toContain("DEFAULT_THROTTLE_RATES");
  });

  it("separates liveness (no database) from readiness (queries it, 503 on failure)", async () => {
    const views = readFileSync(path.join(await generate(), "apps/core/views.py"), "utf-8");
    expect(views).toContain("SELECT 1");
    expect(views).toContain("HTTP_503_SERVICE_UNAVAILABLE");
    expect(views).toContain("@throttle_classes([])");
  });

  it("ships a migration and a test that fails if the model drifts from it", async () => {
    const outDir = await generate();
    expect(existsSync(path.join(outDir, "apps/items/migrations/0001_initial.py"))).toBe(true);
    expect(readFileSync(path.join(outDir, "apps/core/tests.py"), "utf-8")).toContain("makemigrations");
  });

  it("serves production with gunicorn, not runserver, as a non-root user", async () => {
    const dockerfile = readFileSync(path.join(await generate({ includeDocker: true }), "Dockerfile"), "utf-8");
    expect(dockerfile).toContain('"gunicorn"');
    expect(dockerfile).toContain("USER appuser");
    expect(dockerfile).not.toMatch(/CMD.*runserver/);
  });

  it("declares dependencies as lower bounds, so one file works on Python 3.10 through 3.13", async () => {
    const reqs = readFileSync(path.join(await generate(), "requirements.txt"), "utf-8");
    expect(reqs).toContain("django>=5.2");
    expect(reqs).not.toMatch(/==/);
  });

  it("gitignores .env and writes only a placeholder in the example", async () => {
    const outDir = await generate({ db: "postgres" });
    expect(readFileSync(path.join(outDir, ".gitignore"), "utf-8")).toMatch(/^\.env$/m);
    expect(readFileSync(path.join(outDir, ".env.example"), "utf-8")).toContain("CHANGE_ME");
  });

  it("omits tests when includeTests is false", async () => {
    const files = listFiles(await generate({}, { includeTests: false }));
    expect(files.filter((f) => f.endsWith("tests.py"))).toEqual([]);
  });
});

describe("resolveDjangoAddons", () => {
  it("defaults to standard + sqlite, and neither shells out nor installs unless asked", () => {
    expect(resolveDjangoAddons({})).toEqual({ structure: "standard", db: "sqlite", includeDocker: false, useCli: false, install: false });
  });

  it("rejects an unknown structure or database by name", () => {
    expect(() => resolveDjangoAddons({ structure: "onion" })).toThrow(/Invalid Django structure 'onion'/);
    expect(() => resolveDjangoAddons({ db: "mongo" })).toThrow(/Invalid database 'mongo'/);
  });
});
