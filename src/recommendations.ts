/**
 * Tool recommendations shown after generation, tied to what was actually
 * selected rather than shown as generic advice. Every entry here was verified
 * as a real, currently-maintained tool before being added (see the session
 * this shipped in for the sources) - the same standard applied to any factual
 * claim in this codebase, not just marketing copy.
 *
 * Tiers stand in for "how urgent is this," without asking the user their job
 * title:
 * - essential: worth doing on day one, regardless of team size or experience.
 * - production: worth doing once real users depend on this.
 * - scale: only bites once you're running more than one instance / at real load.
 */

export type RecommendationTier = "essential" | "production" | "scale";

export interface Recommendation {
  id: string;
  name: string;
  tier: RecommendationTier;
  description: string;
  url: string;
  appliesTo: (ctx: RecommendationContext) => boolean;
}

export interface RecommendationContext {
  stack: string;
  hasDb: boolean;
  includeJwt: boolean;
  includeDocker: boolean;
  includeTests: boolean;
  usesLlmApi: boolean;
}

/** Reads whatever a stack's own addons bag happens to expose, without assuming every stack provides the same shape. */
export function buildRecommendationContext(stack: string, addons: Record<string, unknown>, includeTests: boolean, usesLlmApi: boolean): RecommendationContext {
  const dbProvider = typeof addons.dbProvider === "string" ? addons.dbProvider : "none";
  return {
    stack,
    hasDb: dbProvider !== "none",
    includeJwt: addons.includeJwt === true,
    includeDocker: addons.includeDocker === true,
    includeTests,
    usesLlmApi,
  };
}

const RECOMMENDATIONS: Recommendation[] = [
  {
    id: "db-guard",
    name: "db-guard",
    tier: "essential",
    description:
      "A backup that's never been restored isn't verified, it's a guess. db-guard actually runs a restore against your Postgres/MySQL/SQLite backup and checks it worked, instead of just checking the file exists.",
    url: "https://github.com/Oluiy/agnostic-db-guard",
    appliesTo: (ctx) => ctx.hasDb,
  },
  {
    id: "testcontainers",
    name: "Testcontainers",
    tier: "essential",
    description:
      "An in-memory/embedded database in tests hides real engine-specific bugs. Testcontainers spins up the actual database (Postgres/MySQL) in Docker for the test run, then tears it down - what you test against is what you deploy.",
    url: "https://testcontainers.com/",
    appliesTo: (ctx) => ctx.hasDb && ctx.includeTests,
  },
  {
    id: "dependency-scan-java",
    name: "OWASP Dependency-Check",
    tier: "essential",
    description:
      "Checks every dependency in this project against the National Vulnerability Database. Free, self-hosted, runs as a Maven plugin: add org.owasp:dependency-check-maven and run 'mvn dependency-check:check'.",
    url: "https://owasp.org/www-project-dependency-check/",
    appliesTo: (ctx) => ctx.stack === "springboot",
  },
  {
    id: "dependency-scan-dotnet",
    name: "dotnet list package --vulnerable",
    tier: "essential",
    description:
      "Already built into the .NET SDK, no install needed. Run 'dotnet list package --vulnerable --include-transitive' before you ship to catch known-vulnerable NuGet packages, including transitive ones.",
    url: "https://learn.microsoft.com/en-us/nuget/concepts/auditing-packages",
    appliesTo: (ctx) => ctx.stack === "aspnetcore",
  },
  {
    id: "spring-actuator",
    name: "Spring Boot Actuator",
    tier: "essential",
    description:
      "One dependency (spring-boot-starter-actuator) gets you /actuator/health and /actuator/metrics for free - the first thing any load balancer, orchestrator, or on-call engineer will ask this service for.",
    url: "https://docs.spring.io/spring-boot/reference/actuator/index.html",
    appliesTo: (ctx) => ctx.stack === "springboot",
  },
  {
    id: "ai-cost-guard",
    name: "ai-cost-guard",
    tier: "production",
    description:
      "A stuck loop or an unbounded max_tokens turns into a real bill fast. ai-cost-guard sits in front of OpenAI/Anthropic/Groq as a drop-in proxy: per-user budgets, response caching, and loop detection, with no client code changes beyond the base URL.",
    url: "https://github.com/Oluiy/ai-cost-guard",
    appliesTo: (ctx) => ctx.usesLlmApi,
  },
  {
    id: "trivy",
    name: "Trivy",
    tier: "production",
    description:
      "Scans the image you're about to ship for known OS and application-dependency vulnerabilities before it reaches a registry. One binary, covers the Dockerfile you just generated: 'trivy image <your-image>'.",
    url: "https://trivy.dev/",
    appliesTo: (ctx) => ctx.includeDocker,
  },
  {
    id: "ai-cost-guard-scale",
    name: "ai-cost-guard: multi-instance budgets",
    tier: "scale",
    description:
      "ai-cost-guard's budget enforcement is per-process by default - correct for one instance, but each replica gets its own view of spend once you run more than one behind a load balancer. Set budget.backend: redis before you scale out, or a user's daily budget can be exceeded by roughly (instance count)x.",
    url: "https://github.com/Oluiy/ai-cost-guard/blob/main/DOCS.md",
    appliesTo: (ctx) => ctx.usesLlmApi,
  },
];

/** Every recommendation whose trigger condition matches the given context, grouped by tier in essential -> production -> scale order. */
export function getRecommendations(ctx: RecommendationContext): Recommendation[] {
  const tierOrder: RecommendationTier[] = ["essential", "production", "scale"];
  return RECOMMENDATIONS.filter((r) => r.appliesTo(ctx)).sort((a, b) => tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier));
}
