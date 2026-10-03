import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { springbootAdapter } from "./adapter.js";
import { resolveSpringBootAddons } from "./addons.js";
import { initializrDependencies } from "./bootstrap.js";
import type { SpringBootAddons } from "./types.js";

const base: SpringBootAddons = {
  structure: "package-by-layer",
  isFourLayer: false,
  dbProvider: "none",
  includeJwt: false,
  includeDocker: false,
  useInitializr: false,
};

describe("initializrDependencies - pure mapping, no network", () => {
  it("always asks for web, validation and actuator", () => {
    expect(initializrDependencies(base)).toEqual(["web", "validation", "actuator"]);
  });

  it("a database brings JPA, a migration tool, the driver, and H2 for tests", () => {
    // flyway is requested so the generated project does not trip buildquick's own
    // no-schema-migrations rule; h2 so its tests run with no server.
    expect(initializrDependencies({ ...base, dbProvider: "postgres" })).toEqual(["web", "validation", "actuator", "data-jpa", "flyway", "postgresql", "h2"]);
    expect(initializrDependencies({ ...base, dbProvider: "mysql" })).toContain("mysql");
    expect(initializrDependencies({ ...base, dbProvider: "mysql" })).not.toContain("postgresql");
  });

  it("JWT adds spring security, and nothing else changes", () => {
    expect(initializrDependencies({ ...base, includeJwt: true })).toEqual(["web", "validation", "actuator", "security"]);
  });
});

describe("resolveSpringBootAddons - useInitializr", () => {
  it("is off by default, so --yes stays offline and deterministic", () => {
    expect(resolveSpringBootAddons({})).toMatchObject({ useInitializr: false });
  });

  it("is honoured when a scripted run opts in", () => {
    expect(resolveSpringBootAddons({ useInitializr: true })).toMatchObject({ useInitializr: true });
  });

  it("is forced off for multi-module, which Initializr cannot produce", () => {
    expect(resolveSpringBootAddons({ structure: "multi-module", useInitializr: true })).toMatchObject({ useInitializr: false });
  });
});

describe("springbootAdapter - the hand-written path still produces a complete build", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "buildquick-spring-bootstrap-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("with useInitializr false it writes its own pom, wrapper and .gitignore - the offline fallback", async () => {
    // This is what runs when Initializr is unreachable, so it has to stand alone.
    // The Initializr path itself needs the network and is verified by compiling a
    // generated project, not by a unit test.
    const outDir = path.join(tmpDir, "out");
    await springbootAdapter.generate(
      {
        projectName: "FallbackApi",
        outputDirectory: tmpDir,
        includeTests: true,
        isMicroservice: false,
        serviceNames: [],
        httpPort: 8080,
        usesLlmApi: false,
        addons: { ...base },
      },
      outDir
    );

    expect(existsSync(path.join(outDir, "pom.xml"))).toBe(true);
    expect(existsSync(path.join(outDir, "mvnw"))).toBe(true);
    expect(existsSync(path.join(outDir, ".gitignore"))).toBe(true);
    expect(readFileSync(path.join(outDir, "pom.xml"), "utf-8")).toContain("spring-boot-starter-parent");
  });

  it("generates exactly one @SpringBootApplication class", async () => {
    // Initializr writes its own Application class too; removeInitializrDefaults
    // deletes it so two never coexist. The hand-written path must also yield one.
    const outDir = path.join(tmpDir, "out");
    await springbootAdapter.generate(
      {
        projectName: "OneApp",
        outputDirectory: tmpDir,
        includeTests: true,
        isMicroservice: false,
        serviceNames: [],
        httpPort: 8080,
        usesLlmApi: false,
        addons: { ...base },
      },
      outDir
    );
    const main = readFileSync(path.join(outDir, "src/main/java/com/buildquick/oneapp/OneAppApplication.java"), "utf-8");
    expect(main.match(/@SpringBootApplication/g)).toHaveLength(1);
  });
});
