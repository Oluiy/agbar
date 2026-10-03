import { describe, expect, it } from "vitest";
import { buildRecommendationContext, getRecommendations } from "./recommendations.js";

function names(ctx: ReturnType<typeof buildRecommendationContext>): string[] {
  return getRecommendations(ctx).map((r) => r.id);
}

describe("buildRecommendationContext", () => {
  it("reads dbProvider/includeJwt/includeDocker off an addons bag that has them", () => {
    const ctx = buildRecommendationContext("springboot", { dbProvider: "postgres", includeJwt: true, includeDocker: true }, true, false);
    expect(ctx).toEqual({ stack: "springboot", hasDb: true, includeJwt: true, includeDocker: true, includeTests: true, usesLlmApi: false });
  });

  it("defaults to no db/jwt/docker for an adapter whose addons bag is empty (e.g. the ASP.NET Core wrapper)", () => {
    const ctx = buildRecommendationContext("aspnetcore", {}, false, true);
    expect(ctx).toEqual({ stack: "aspnetcore", hasDb: false, includeJwt: false, includeDocker: false, includeTests: false, usesLlmApi: true });
  });

  it("treats dbProvider 'none' as no database", () => {
    const ctx = buildRecommendationContext("springboot", { dbProvider: "none" }, false, false);
    expect(ctx.hasDb).toBe(false);
  });
});

describe("getRecommendations", () => {
  it("recommends nothing for a bare project with no triggers", () => {
    const ctx = buildRecommendationContext("aspnetcore", {}, false, false);
    // aspnetcore still always gets its dependency-scan tip regardless of other choices.
    expect(names(ctx)).toEqual(["dependency-scan-dotnet"]);
  });

  it("recommends db-guard whenever a database is selected, regardless of stack", () => {
    const ctx = buildRecommendationContext("springboot", { dbProvider: "postgres" }, false, false);
    expect(names(ctx)).toContain("db-guard");
  });

  it("only recommends Testcontainers when both a database AND tests are selected", () => {
    const withTests = buildRecommendationContext("springboot", { dbProvider: "postgres" }, true, false);
    const withoutTests = buildRecommendationContext("springboot", { dbProvider: "postgres" }, false, false);
    expect(names(withTests)).toContain("testcontainers");
    expect(names(withoutTests)).not.toContain("testcontainers");
  });

  it("recommends the Java-specific dependency scanner for springboot and the .NET one for aspnetcore, never both", () => {
    const spring = buildRecommendationContext("springboot", {}, false, false);
    const aspnet = buildRecommendationContext("aspnetcore", {}, false, false);
    expect(names(spring)).toContain("dependency-scan-java");
    expect(names(spring)).not.toContain("dependency-scan-dotnet");
    expect(names(aspnet)).toContain("dependency-scan-dotnet");
    expect(names(aspnet)).not.toContain("dependency-scan-java");
  });

  it("recommends Spring Boot Actuator only for springboot", () => {
    expect(names(buildRecommendationContext("springboot", {}, false, false))).toContain("spring-actuator");
    expect(names(buildRecommendationContext("aspnetcore", {}, false, false))).not.toContain("spring-actuator");
  });

  it("recommends both ai-cost-guard tiers whenever the project calls an LLM API, for any stack", () => {
    const ctx = buildRecommendationContext("aspnetcore", {}, false, true);
    expect(names(ctx)).toContain("ai-cost-guard");
    expect(names(ctx)).toContain("ai-cost-guard-scale");
  });

  it("does not recommend ai-cost-guard when usesLlmApi is false", () => {
    const ctx = buildRecommendationContext("springboot", {}, false, false);
    expect(names(ctx)).not.toContain("ai-cost-guard");
  });

  it("recommends Trivy only when Docker is selected", () => {
    const withDocker = buildRecommendationContext("springboot", { includeDocker: true }, false, false);
    const withoutDocker = buildRecommendationContext("springboot", { includeDocker: false }, false, false);
    expect(names(withDocker)).toContain("trivy");
    expect(names(withoutDocker)).not.toContain("trivy");
  });

  it("always sorts results essential -> production -> scale", () => {
    const ctx = buildRecommendationContext("springboot", { dbProvider: "postgres", includeDocker: true }, true, true);
    const tiers = getRecommendations(ctx).map((r) => r.tier);
    const essentialLast = tiers.lastIndexOf("essential");
    const productionFirst = tiers.indexOf("production");
    const scaleFirst = tiers.indexOf("scale");
    expect(essentialLast).toBeLessThan(productionFirst === -1 ? Infinity : productionFirst);
    expect(productionFirst === -1 ? -Infinity : productionFirst).toBeLessThanOrEqual(scaleFirst === -1 ? Infinity : scaleFirst);
  });
});
