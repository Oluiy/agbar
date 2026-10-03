import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NEST_VERSIONS } from "./nestjs/versions.js";
import { NODE_VERSIONS } from "./node/versions.js";

/**
 * Renovate keeps the generated-project pins current only if it can *see* them: a pin
 * without a `// renovate:` line above it is invisible to the bot and silently rots. This
 * applies the exact regex from renovate.json to each file, so a pin added later without
 * an annotation - or an annotation that no longer matches - fails here, not in a year.
 */
const root = path.resolve(import.meta.dirname, "../..");
const renovate = JSON.parse(readFileSync(path.join(root, "renovate.json"), "utf-8"));
const manager = renovate.customManagers[0];
const pattern = new RegExp(manager.matchStrings[0], "g");
const filePatterns: RegExp[] = manager.managerFilePatterns.map((p: string) => new RegExp(p.slice(1, -1)));

/** Values that are not npm packages, so they are deliberately not tracked. */
const UNTRACKED = new Set(["nodeEngine"]);

const FILES = [
  { rel: "src/stacks/node/versions.ts", pins: NODE_VERSIONS },
  { rel: "src/stacks/nestjs/versions.ts", pins: NEST_VERSIONS },
];

describe.each(FILES)("$rel", ({ rel, pins }) => {
  const text = readFileSync(path.join(root, rel), "utf-8");
  const matches = [...text.matchAll(pattern)].map((m) => m.groups!);

  it("is a file Renovate's custom manager scans", () => {
    expect(filePatterns.some((p) => p.test(rel))).toBe(true);
  });

  it("annotates every package pin, so none is invisible to Renovate", () => {
    const tracked = Object.entries(pins).filter(([key]) => !UNTRACKED.has(key));
    expect(matches).toHaveLength(tracked.length);
    // Each match captured the value actually in the object, in order.
    expect(matches.map((m) => m.currentValue)).toEqual(tracked.map(([, value]) => value));
  });

  it("tracks npm packages by their real names", () => {
    for (const m of matches) {
      expect(m.datasource).toBe("npm");
      expect(m.depName).toMatch(/^(@[a-z0-9-]+\/)?[a-z0-9.-]+$/);
    }
  });
});

describe("src/stacks/springboot/templates/pom.ts (Maven pins)", () => {
  const rel = "src/stacks/springboot/templates/pom.ts";
  const text = readFileSync(path.join(root, rel), "utf-8");
  const mavenManager = renovate.customManagers[1];
  const mavenPattern = new RegExp(mavenManager.matchStrings[0], "g");
  const matches = [...text.matchAll(mavenPattern)].map((m) => m.groups!);

  it("is scanned by the Maven custom manager", () => {
    expect(mavenManager.managerFilePatterns.some((p: string) => new RegExp(p.slice(1, -1)).test(rel))).toBe(true);
    expect(mavenManager.versioningTemplate).toBe("maven");
  });

  it("tracks Spring Boot and jjwt by their real Maven coordinates, so neither rots unseen", () => {
    expect(matches.map((m) => m.depName).sort()).toEqual(["io.jsonwebtoken:jjwt-api", "org.springframework.boot:spring-boot-starter-parent"]);
    for (const m of matches) {
      expect(m.datasource).toBe("maven");
      expect(m.currentValue).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});

describe("held-back majors in renovate.json", () => {
  const held = new Map<string, string>(
    renovate.packageRules
      .filter((r: { allowedVersions?: string }) => r.allowedVersions)
      .flatMap((r: { matchPackageNames: string[]; allowedVersions: string }) => r.matchPackageNames.map((n) => [n, r.allowedVersions]))
  );

  // The pins below are deliberately not the newest major; each was learned by a real
  // install. If one of these fails, the rule and the pin have drifted apart.
  it.each([
    ["typescript", "<7", NODE_VERSIONS.typescript],
    ["prisma", "<8", NODE_VERSIONS.prisma],
    ["drizzle-orm", "<1.0.0", NODE_VERSIONS.drizzleOrm],
    ["sequelize", "<7", NODE_VERSIONS.sequelize],
    ["better-sqlite3", "<13", NODE_VERSIONS.betterSqlite3],
    ["class-validator", "<0.15.0", NEST_VERSIONS.classValidator],
  ])("%s is held at %s, and the current pin respects it", (pkg, rule, pin) => {
    expect(held.get(pkg)).toBe(rule);
    const pinnedMajorMinor = pin.replace(/^\^/, "").split(".").map(Number);
    const limit = rule.replace(/^</, "").split(".").map(Number);
    const below = pinnedMajorMinor[0]! < limit[0]! || (pinnedMajorMinor[0] === limit[0] && (pinnedMajorMinor[1] ?? 0) < (limit[1] ?? 0));
    expect(below, `${pkg} ${pin} must be below ${rule}`).toBe(true);
  });
});
