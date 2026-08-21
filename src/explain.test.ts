import { describe, expect, it } from "vitest";
import { buildDecisionContext, getDecisions } from "./explain.js";

function ids(ctx: ReturnType<typeof buildDecisionContext>): string[] {
  return getDecisions(ctx).map((d) => d.id);
}

describe("buildDecisionContext", () => {
  it("reads structure/dbProvider/includeJwt/includeDocker off an addons bag that has them", () => {
    const ctx = buildDecisionContext(
      "springboot",
      { structure: "multi-module", dbProvider: "postgres", includeJwt: true, includeDocker: true },
      true,
      false
    );
    expect(ctx).toEqual({
      stack: "springboot",
      structure: "multi-module",
      hasDb: true,
      includeJwt: true,
      includeDocker: true,
      includeTests: true,
      isMicroservice: false,
    });
  });

  it("leaves structure undefined for an adapter whose addons bag has none (e.g. the ASP.NET Core wrapper)", () => {
    const ctx = buildDecisionContext("aspnetcore", {}, false, false);
    expect(ctx.structure).toBeUndefined();
    expect(ctx.hasDb).toBe(false);
  });

  it("treats dbProvider 'none' as no database", () => {
    const ctx = buildDecisionContext("springboot", { dbProvider: "none" }, false, false);
    expect(ctx.hasDb).toBe(false);
  });
});

describe("getDecisions", () => {
  it("gives a bare package-by-layer springboot project the interface/DIP and config-layering callouts, nothing addon-gated", () => {
    const ctx = buildDecisionContext("springboot", { structure: "package-by-layer" }, false, false);
    expect(ids(ctx)).toEqual([
      "springboot-controller-depends-on-interface",
      "springboot-structure-package-by-layer",
      "springboot-config-layering",
    ]);
  });

  it("only the matching structure-mode callout appears, never more than one", () => {
    const multiModule = buildDecisionContext("springboot", { structure: "multi-module" }, false, false);
    const byLayer = buildDecisionContext("springboot", { structure: "package-by-layer" }, false, false);
    const byFeature = buildDecisionContext("springboot", { structure: "package-by-feature" }, false, false);

    expect(ids(multiModule)).toContain("springboot-structure-multi-module");
    expect(ids(multiModule)).not.toContain("springboot-structure-package-by-layer");
    expect(ids(multiModule)).not.toContain("springboot-structure-package-by-feature");

    expect(ids(byLayer)).toContain("springboot-structure-package-by-layer");
    expect(ids(byLayer)).not.toContain("springboot-structure-multi-module");

    expect(ids(byFeature)).toContain("springboot-structure-package-by-feature");
    expect(ids(byFeature)).not.toContain("springboot-structure-multi-module");
  });

  it("adds the JWT-separation callout only when JWT is included", () => {
    const withJwt = buildDecisionContext("springboot", { includeJwt: true }, false, false);
    const withoutJwt = buildDecisionContext("springboot", { includeJwt: false }, false, false);
    expect(ids(withJwt)).toContain("springboot-jwt-separation");
    expect(ids(withoutJwt)).not.toContain("springboot-jwt-separation");
  });

  it("adds the Docker multi-stage callout only when Docker is included", () => {
    const withDocker = buildDecisionContext("springboot", { includeDocker: true }, false, false);
    const withoutDocker = buildDecisionContext("springboot", { includeDocker: false }, false, false);
    expect(ids(withDocker)).toContain("springboot-docker-multistage");
    expect(ids(withoutDocker)).not.toContain("springboot-docker-multistage");
  });

  it("requires both a database AND tests before the no-real-db test-isolation callout appears", () => {
    const both = buildDecisionContext("springboot", { dbProvider: "postgres" }, true, false);
    const dbOnly = buildDecisionContext("springboot", { dbProvider: "postgres" }, false, false);
    const testsOnly = buildDecisionContext("springboot", { dbProvider: "none" }, true, false);
    expect(ids(both)).toContain("springboot-test-no-real-db");
    expect(ids(dbOnly)).not.toContain("springboot-test-no-real-db");
    expect(ids(testsOnly)).not.toContain("springboot-test-no-real-db");
  });

  it("adds the microservice-independence callout only in microservice mode", () => {
    const mono = buildDecisionContext("springboot", {}, false, false);
    const micro = buildDecisionContext("springboot", {}, false, true);
    expect(ids(mono)).not.toContain("springboot-microservice-independence");
    expect(ids(micro)).toContain("springboot-microservice-independence");
  });

  it("an aspnetcore project (empty addons bag) gets exactly the one general DIP callout", () => {
    const ctx = buildDecisionContext("aspnetcore", {}, false, false);
    expect(ids(ctx)).toEqual(["aspnetcore-service-interface-pattern"]);
  });

  it("a fully-loaded springboot config surfaces every applicable callout with no duplicates", () => {
    const ctx = buildDecisionContext(
      "springboot",
      { structure: "multi-module", dbProvider: "postgres", includeJwt: true, includeDocker: true },
      true,
      true
    );
    const result = ids(ctx);
    expect(new Set(result).size).toBe(result.length);
    expect(result).toEqual(
      expect.arrayContaining([
        "springboot-controller-depends-on-interface",
        "springboot-structure-multi-module",
        "springboot-jwt-separation",
        "springboot-config-layering",
        "springboot-docker-multistage",
        "springboot-test-no-real-db",
        "springboot-microservice-independence",
      ])
    );
  });
});
