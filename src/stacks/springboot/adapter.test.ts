import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { springbootAdapter } from "./adapter.js";
import type { ScaffoldConfig } from "../../config.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "buildquick-springboot-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Every file under `dir`, as paths relative to `dir`, sorted - the shape a snapshot diff actually reads clearly. */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  function walk(current: string) {
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        out.push(path.relative(dir, full));
      }
    }
  }
  walk(dir);
  return out.sort();
}

function baseConfig(overrides: Partial<ScaffoldConfig> = {}): ScaffoldConfig {
  return {
    projectName: "SnapApp",
    outputDirectory: tmpDir,
    includeTests: true,
    isMicroservice: false,
    serviceNames: [],
    httpPort: 8080,
    usesLlmApi: false,
    addons: { structure: "package-by-layer", isFourLayer: false, dbProvider: "none", includeJwt: false, includeDocker: false },
    ...overrides,
  };
}

describe("springbootAdapter.generate - file tree", () => {
  it("Multi-Module, 4-layer, Postgres, JWT, Docker, tests", async () => {
    const outDir = path.join(tmpDir, "out");
    const config = baseConfig({
      addons: { structure: "multi-module", isFourLayer: true, dbProvider: "postgres", includeJwt: true, includeDocker: true },
    });
    await springbootAdapter.generate(config, outDir);
    expect(listFiles(outDir)).toMatchSnapshot();
  });

  it("Multi-Module, 3-layer, bare (no db/jwt/docker/tests)", async () => {
    const outDir = path.join(tmpDir, "out");
    const config = baseConfig({
      includeTests: false,
      addons: { structure: "multi-module", isFourLayer: false, dbProvider: "none", includeJwt: false, includeDocker: false },
    });
    await springbootAdapter.generate(config, outDir);
    expect(listFiles(outDir)).toMatchSnapshot();
  });

  it("Package-by-Layer, MySQL, JWT", async () => {
    const outDir = path.join(tmpDir, "out");
    const config = baseConfig({
      addons: { structure: "package-by-layer", isFourLayer: false, dbProvider: "mysql", includeJwt: true, includeDocker: false },
    });
    await springbootAdapter.generate(config, outDir);
    expect(listFiles(outDir)).toMatchSnapshot();
  });

  it("Package-by-Feature, JWT - health/ and auth/ packages instead of technical layers", async () => {
    const outDir = path.join(tmpDir, "out");
    const config = baseConfig({
      addons: { structure: "package-by-feature", isFourLayer: false, dbProvider: "none", includeJwt: true, includeDocker: false },
    });
    await springbootAdapter.generate(config, outDir);
    expect(listFiles(outDir)).toMatchSnapshot();
  });

  it("Microservice: 2 services under a reactor root", async () => {
    const outDir = path.join(tmpDir, "out");
    const config = baseConfig({
      isMicroservice: true,
      serviceNames: ["Orders", "Payments"],
      addons: { structure: "package-by-layer", isFourLayer: false, dbProvider: "none", includeJwt: false, includeDocker: false },
    });
    await springbootAdapter.generate(config, outDir);
    expect(listFiles(outDir)).toMatchSnapshot();
  });
});

describe("springbootAdapter.generate - content correctness", () => {
  it("Multi-Module wires the api module's pom.xml to depend on application+infrastructure, not domain directly", async () => {
    const outDir = path.join(tmpDir, "out");
    const config = baseConfig({
      addons: { structure: "multi-module", isFourLayer: true, dbProvider: "none", includeJwt: false, includeDocker: false },
    });
    await springbootAdapter.generate(config, outDir);
    const apiPom = readFileSync(path.join(outDir, "snapapp-api", "pom.xml"), "utf-8");
    expect(apiPom).toContain("snapapp-application");
    expect(apiPom).toContain("snapapp-infrastructure");
    expect(apiPom).not.toContain("snapapp-domain");
  });

  it("Package-by-Layer puts everything under one pom.xml with no submodules", async () => {
    const outDir = path.join(tmpDir, "out");
    const config = baseConfig();
    await springbootAdapter.generate(config, outDir);
    expect(listFiles(outDir).some((f) => f.startsWith("snapapp-"))).toBe(false);
    const pom = readFileSync(path.join(outDir, "pom.xml"), "utf-8");
    expect(pom).not.toContain("<modules>");
  });

  it("JWT off means no security/auth files are written at all", async () => {
    const outDir = path.join(tmpDir, "out");
    const config = baseConfig({ addons: { structure: "package-by-layer", isFourLayer: false, dbProvider: "none", includeJwt: false, includeDocker: false } });
    await springbootAdapter.generate(config, outDir);
    const files = listFiles(outDir);
    expect(files.some((f) => f.includes("Auth"))).toBe(false);
    expect(files.some((f) => f.includes("Security") || f.includes("JwtAuthFilter"))).toBe(false);
  });

  it("every generated project includes the Maven Wrapper", async () => {
    const outDir = path.join(tmpDir, "out");
    await springbootAdapter.generate(baseConfig(), outDir);
    const files = listFiles(outDir);
    expect(files).toContain("mvnw");
    expect(files).toContain("mvnw.cmd");
  });
});
