/**
 * "Why does my project look like this?" - after generation, buildquick writes an
 * ARCHITECTURE.md into the project tying each structural choice that was actually
 * made to the engineering principle behind it, referencing the real classes that
 * were written, not abstract examples. The point isn't just scaffolding fast code -
 * it's leaving something behind that explains itself, since generated code is
 * otherwise indistinguishable from code an AI wrote and handed over cold.
 *
 * Same shape as recommendations.ts on purpose: a flat list of entries with an
 * appliesTo(ctx) predicate, filtered down and rendered after generation.
 */

export interface DecisionContext {
  stack: string;
  structure?: string; // springboot only: "multi-module" | "package-by-layer" | "package-by-feature"
  hasDb: boolean;
  includeJwt: boolean;
  includeDocker: boolean;
  includeTests: boolean;
  isMicroservice: boolean;
}

export interface Decision {
  id: string;
  title: string;
  principle: string;
  explanation: string;
  appliesTo: (ctx: DecisionContext) => boolean;
}

/** Reads whatever a stack's own addons bag happens to expose, without assuming every stack provides the same shape. */
export function buildDecisionContext(
  stack: string,
  addons: Record<string, unknown>,
  includeTests: boolean,
  isMicroservice: boolean
): DecisionContext {
  const dbProvider = typeof addons.dbProvider === "string" ? addons.dbProvider : "none";
  return {
    stack,
    structure: typeof addons.structure === "string" ? addons.structure : undefined,
    hasDb: dbProvider !== "none",
    includeJwt: addons.includeJwt === true,
    includeDocker: addons.includeDocker === true,
    includeTests,
    isMicroservice,
  };
}

const DECISIONS: Decision[] = [
  {
    id: "springboot-controller-depends-on-interface",
    title: "Controllers depend on an interface, not a concrete class",
    principle: "Dependency Inversion Principle (DIP)",
    explanation:
      "HealthController's constructor takes a HealthService - the interface - not HealthServiceImpl directly. Spring resolves the real @Service bean at runtime through constructor injection. Swap HealthServiceImpl for a different implementation, or a fake in a test, and HealthController never changes. That's DIP: depend on an abstraction, not the concrete thing behind it.",
    appliesTo: (ctx) => ctx.stack === "springboot",
  },
  {
    id: "springboot-structure-multi-module",
    title: "Layers are separate Maven modules, not just folders",
    principle: "Dependency Inversion Principle (DIP), enforced at compile time",
    explanation:
      "Multi-Module structure makes the domain -> application -> infrastructure -> api dependency direction physical, not just a convention. Each layer's pom.xml only lists the modules it's allowed to depend on - domain lists none of the others; api depends on application and infrastructure. Try to import an infrastructure class from domain and the project won't compile - Maven enforces the boundary a code reviewer would otherwise have to catch by eye.",
    appliesTo: (ctx) => ctx.stack === "springboot" && ctx.structure === "multi-module",
  },
  {
    id: "springboot-structure-package-by-layer",
    title: "One package per technical role",
    principle: "Single Responsibility Principle (SRP), by convention rather than the compiler",
    explanation:
      "Package-by-Layer groups classes by what they are (controller/service/entity) - the layout most Spring tutorials teach. Nothing stops a class in one package from reaching into another the wrong way except code review discipline; unlike Multi-Module, there's no module boundary to enforce it. That's the tradeoff: a single, simpler module to build, in exchange for losing compiler-level enforcement.",
    appliesTo: (ctx) => ctx.stack === "springboot" && ctx.structure === "package-by-layer",
  },
  {
    id: "springboot-structure-package-by-feature",
    title: "One package per feature, not per technical role",
    principle: "High cohesion (SRP applied at the feature level) + DRY",
    explanation:
      "Package-by-Feature keeps everything about one concern together - auth/ holds AuthController, AuthService, AuthServiceImpl, and the JWT security classes in one place, instead of scattering them across controller/, service/, and security/ packages. When 'auth' changes, you're editing one folder instead of hunting across four - the same reasoning behind DRY (one place for one concept), applied to file organization instead of code.",
    appliesTo: (ctx) => ctx.stack === "springboot" && ctx.structure === "package-by-feature",
  },
  {
    id: "springboot-jwt-separation",
    title: "Issuing a token and verifying one are two different classes",
    principle: "Single Responsibility Principle (SRP)",
    explanation:
      "AuthServiceImpl only issues tokens (POST /api/auth/token). JwtAuthFilter only validates tokens already presented on incoming requests. Each class has exactly one reason to change - signing logic changes, or verification logic changes, never both at once - and a bug in one can't hide inside the other.",
    appliesTo: (ctx) => ctx.stack === "springboot" && ctx.includeJwt,
  },
  {
    id: "springboot-config-layering",
    title: "One base config file, two environment overlays",
    principle: "DRY + the 12-Factor App's config-in-environment principle",
    explanation:
      "application.yml holds everything that's the same everywhere. application-dev.yml and application-prod.yml only override what actually differs per environment (datasource URL, logging level) - they don't repeat the shared structure. Switch which one loads with a single Spring profile, instead of maintaining two full copies of the same file that quietly drift apart.",
    appliesTo: (ctx) => ctx.stack === "springboot",
  },
  {
    id: "springboot-docker-multistage",
    title: "The Dockerfile has a build stage and a separate runtime stage",
    principle: "Separation of concerns",
    explanation:
      "The Maven build tools, source code, and full dependency tree exist only in the first stage. The final image copies out just the compiled jar and runs it on a slim JRE - none of the build-time weight ships to production. If you've only ever seen a single-stage Dockerfile, this is why real ones rarely look like that.",
    appliesTo: (ctx) => ctx.stack === "springboot" && ctx.includeDocker,
  },
  {
    id: "springboot-test-no-real-db",
    title: "The generated test never touches a real database",
    principle: "Test isolation",
    explanation:
      "HealthControllerTests points at an in-memory H2 database instead of the PostgreSQL/MySQL configured for dev/prod. The test verifies your code, not whether a database happened to be reachable - it passes the same way in CI, on a laptop with no Postgres installed, or with the real database down.",
    appliesTo: (ctx) => ctx.stack === "springboot" && ctx.hasDb && ctx.includeTests,
  },
  {
    id: "springboot-microservice-independence",
    title: "Each service is a fully independent Maven project",
    principle: "Loose coupling / bounded contexts",
    explanation:
      "Every service under services/ has its own pom.xml, own package, own build - nothing shared at runtime. The root pom.xml is only a Maven reactor, a convenience for building everything in one command locally; it isn't a dependency any service actually needs to run. Deploy, scale, or rewrite one service without touching the others.",
    appliesTo: (ctx) => ctx.stack === "springboot" && ctx.isMicroservice,
  },
  {
    id: "aspnetcore-service-interface-pattern",
    title: "BuildQuickPkg wires the same interface/implementation pattern",
    principle: "Dependency Inversion Principle (DIP)",
    explanation:
      "BuildQuickPkg's Controller-style output puts interfaces in Services/Interfaces and implementations in Services/Implementation, registered against the interface in Program.cs (builder.Services.AddScoped<IXService, XService>()). Controllers depend on the interface type, never the concrete class - the same DIP pattern as the Spring Boot output, so switching stacks doesn't mean relearning the underlying idea. (Aggregator hands off to BuildQuickPkg's own interactive prompts, so it can't see which exact options you chose there - this callout is general, not tied to your specific run.)",
    appliesTo: (ctx) => ctx.stack === "aspnetcore",
  },
];

/** Every decision whose trigger condition matches the given context, in fixed declaration order. */
export function getDecisions(ctx: DecisionContext): Decision[] {
  return DECISIONS.filter((d) => d.appliesTo(ctx));
}
