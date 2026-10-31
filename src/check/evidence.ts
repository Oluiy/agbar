import { anyCodeMatches, anyTextMatches, codeFiles, dependsOnAny } from "./repo.js";
import type { RepoSnapshot } from "./types.js";

/**
 * Researched per-ecosystem evidence for "absence" rules.
 *
 * These rules used to match generic English - `throttle`, `ping` - which meant a
 * lodash `throttle` import or a websocket heartbeat silently suppressed a real
 * finding. That's a false negative, and a quiet one: the check reports a pass.
 *
 * The fix is positive evidence: match the actual library names and call
 * signatures that only appear when the mechanism is really wired up. Two rules
 * for everything in this file:
 *
 * 1. No bare English words. `throttle` is banned; `@Throttle(` (NestJS's
 *    decorator, with the paren) is fine because nothing else looks like it.
 * 2. Dependency names and code symbols are checked separately - a package in
 *    package.json proves intent, a symbol in source proves wiring.
 */

// ---------------------------------------------------------------------------
// HTTP entrypoints - is this actually a service that serves requests?
// ---------------------------------------------------------------------------

/**
 * Having `express` in package.json doesn't make a repo an HTTP service - it
 * could be a library, a CLI, or a test helper. Gate the HTTP-only rules on a
 * real server being constructed *or* real routes being registered somewhere in
 * source.
 *
 * Route registration counts on purpose: plenty of real apps put `express()` and
 * `listen()` in one file and the routes in another, so requiring the bootstrap
 * call would miss services whose routes are all this scan can see. A library
 * doesn't register HTTP routes.
 *
 * The "quoted path starting with `/`" requirement is doing real work: Express
 * overloads `app.get` as a settings getter (`app.get('env')`), so a bare
 * `app.get\s*\(` would call anything that reads config an HTTP service.
 *
 * Deliberately NOT exported: on its own this is not safe to gate a rule on, so
 * `servesHttp` below is the only way to reach it. Found by running `check` on
 * BuildQuickPkg, a .NET *CLI* that emits ASP.NET projects: its templates contain
 * the literal string `WebApplication.CreateBuilder(args)`, so this returns true
 * for a command-line tool. Any code generator, tutorial repo, or docs site
 * quoting server bootstrap code does the same. Matching only in code (not inside
 * strings/comments - see literals.ts) now catches most of that, but a template
 * file is still code; the framework-dependency half is what settles it.
 *
 * Go routes are capitalised (`app.Get("/x")` in Fiber/Echo), hence the second
 * route alternative.
 */
const HTTP_ENTRYPOINT =
  /\b(app|router|api)\.(get|post|put|patch|delete|all)\s*\(\s*["'`]\/|\b(app|router|api|r|e|g)\.(Get|Post|Put|Patch|Delete|HandleFunc)\s*\(\s*"\/|fiber\.New\s*\(|http\.HandleFunc\s*\(|rocket::build|#\[launch\]|warp::serve|Route::new\s*\(\)|@Path\s*\(|@Controller\s*\(|embeddedServer\s*\(|Javalin\.create|new Hono\s*\(|new Elysia\s*\(|\bexpress\s*\(\)|\bapp\.listen\s*\(|Fastify\s*\(|new Koa\s*\(|NestFactory\.create\s*\(|http\.createServer\s*\(|@RestController|@SpringBootApplication|SpringApplication\.run|WebApplication\.CreateBuilder|\[ApiController\]|:\s*ControllerBase|FastAPI\s*\(|Flask\s*\(|APIRouter\s*\(|@app\.(route|get|post)|urlpatterns\s*=|Rails\.application|<\s*ActionController|http\.ListenAndServe|gin\.(Default|New)\s*\(|echo\.New\s*\(|chi\.NewRouter\s*\(|mux\.NewRouter\s*\(|HttpServer::new|Router::new/;

function isHttpService(repo: RepoSnapshot): boolean {
  return anyCodeMatches(repo, HTTP_ENTRYPOINT);
}

/** Web frameworks whose presence makes the HTTP-only rules worth running. */
const HTTP_FRAMEWORKS = [
  "express",
  "fastify",
  "koa",
  "nestjs",
  "@nestjs/",
  "spring-boot-starter-web",
  "microsoft.aspnetcore",
  "flask",
  "django",
  "fastapi",
  "gin-gonic",
  "axum",
  "actix-web",
  "rails",
  // Go routers beyond gin - missing Fiber meant ai-cost-guard's server was
  // silently never checked for a rate limiter or health endpoint at all.
  "gofiber/fiber",
  "labstack/echo",
  "go-chi/chi",
  "gorilla/mux",
  // A .NET 6+ web project declares no Microsoft.AspNetCore package at all - its
  // SDK is the dependency (see dependencyText in manifests.ts).
  "microsoft.net.sdk.web",
  // Other frameworks each stack's developers actually choose.
  "rocket",
  "warp",
  "poem",
  "tide", // Rust
  "quarkus",
  "micronaut",
  "io.ktor",
  "ktor-server",
  "javalin",
  "io.vertx", // JVM
  "hono",
  "elysia",
  "@hapi/hapi",
  "restify", // Node / Bun
  // AdonisJS: missing it meant an Adonis API was never checked for a rate limiter or a
  // health endpoint - found by grading agbar's own generated Adonis project.
  "@adonisjs/core",
  "sanic",
  "starlette",
  "tornado",
  "aiohttp", // Python
];

/**
 * Go's standard library serves HTTP with no dependency to declare, so a
 * `net/http` server never appears in go.mod. The import line is the dependency
 * signal instead - anchored to a whole line, so a string that merely mentions
 * "net/http" doesn't count.
 */
function usesGoStdlibHttp(repo: RepoSnapshot): boolean {
  return codeFiles(repo).some((f) => f.relPath.endsWith(".go") && /^\s*(import\s+)?(\w+\s+)?"net\/http"\s*\)?\s*$/m.test(f.content));
}

/**
 * The gate every HTTP-only rule should use: a web framework in the manifest AND
 * a server or route in source. Both halves are load-bearing - see the warning on
 * HTTP_ENTRYPOINT for what the dependency check is protecting against.
 *
 * One function rather than the pair spelled out per rule, so the two HTTP rules
 * can't drift apart on what counts as an HTTP service when a framework is added.
 */
export function servesHttp(repo: RepoSnapshot): boolean {
  return (dependsOnAny(repo, HTTP_FRAMEWORKS) || usesGoStdlibHttp(repo)) && isHttpService(repo);
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * Packages whose *presence* is evidence, because a project only takes them on to
 * limit request rates. A dependency that merely *supports* rate limiting as an
 * opt-in feature does not belong here - Django REST Framework and Spring Cloud
 * Gateway were both removed for that reason. DRF ships throttling classes but
 * they are off until `DEFAULT_THROTTLE_RATES` is set, so listing it marked every
 * DRF project as rate-limited; the real config is matched as a symbol below.
 */
const RATE_LIMIT_DEPS = [
  // Node
  "express-rate-limit",
  "express-slow-down",
  "rate-limiter-flexible",
  "@nestjs/throttler",
  "@fastify/rate-limit",
  "fastify-rate-limit",
  "koa-ratelimit",
  "@upstash/ratelimit",
  "bottleneck",
  "@adonisjs/limiter",
  // JVM
  "bucket4j",
  "resilience4j-ratelimiter",
  // .NET (built-in for .NET 7+, matched by AddRateLimiter( below)
  "aspnetcoreratelimit",
  // Python
  "slowapi",
  "flask-limiter",
  "django-ratelimit",
  // Ruby
  "rack-attack",
  // Go
  "golang.org/x/time/rate",
  "tollbooth",
  "ulule/limiter",
  "redis_rate",
  "throttled",
  // Rust ("governor" also covers tower-governor - manifest matching is substring)
  "governor",
];

/**
 * Call signatures and annotations, never bare words. Each of these is
 * meaningless outside a rate limiter, which is the whole point.
 *
 * `\bLimiter\s*\(` (slowapi's `limiter = Limiter(key_func=...)`) needs the word
 * boundary: without it, the pattern matched the tail of any `SizeLimiter(`,
 * `RowLimiter(` or `ConcurrencyLimiter(` - bounding a buffer or a worker pool,
 * nothing to do with per-client request limits. That is the same mistake as the
 * bare `throttle` this file exists to undo.
 */
const RATE_LIMIT_SYMBOLS =
  /\brateLimit\s*\(|\brateLimiter\s*\(|RateLimiterMemory|RateLimiterRedis|@Throttle\s*\(|ThrottlerGuard|ThrottlerModule|@RateLimiter\s*\(|Bucket4j|Bucket\.builder\s*\(|RateLimiter\.(create|of)\s*\(|AddRateLimiter\s*\(|UseRateLimiter\s*\(|EnableRateLimiting|@limiter\.limit\s*\(|\bLimiter\s*\(|@ratelimit\s*\(|DEFAULT_THROTTLE_RATES|DEFAULT_THROTTLE_CLASSES|(Scoped|User|Anon)RateThrottle|Re(quest|dis)RateLimiter|Rack::Attack|rate\.NewLimiter\s*\(|tollbooth\.|limiter\.New\s*\(|GovernorLayer|RateLimitLayer/;

export function hasRateLimiting(repo: RepoSnapshot): boolean {
  return dependsOnAny(repo, RATE_LIMIT_DEPS) || anyTextMatches(repo, RATE_LIMIT_SYMBOLS);
}

// ---------------------------------------------------------------------------
// Health checks
// ---------------------------------------------------------------------------

const HEALTHCHECK_DEPS = ["@godaddy/terminus", "@nestjs/terminus", "express-healthcheck", "spring-boot-starter-actuator", "django-health-check"];

/**
 * The health segment must be preceded by a slash somewhere in a quoted path.
 * A bare quoted "ping" is not enough: a websocket heartbeat
 * (`socket.emit('ping')`) used to match and suppress the finding on services
 * with no health endpoint at all. "/ping" as a route is a real health check;
 * 'ping' as a message name is not.
 *
 * Leading path segments are allowed because requiring the path to *start* with
 * the health segment missed `/api/health`, `/v1/internal/health` and friends -
 * one of the most common ways real services mount this - and flagged those
 * services as having no health endpoint. The suffix group keeps `/health/db`
 * matching while still rejecting `/healthy-snacks`.
 *
 * Route words stay lowercase (every framework's documented convention). Case
 * variants don't need covering: ASP.NET is matched by `AddHealthChecks(` /
 * `MapHealthChecks(` and Spring by `/actuator/health`, whatever the path case.
 */
const HEALTHCHECK_SYMBOLS =
  // Frameworks that take the path as a decorator argument, often with NO leading
  // slash: NestJS `@Controller('health')`, `@Get('health')`, Spring `@GetMapping("health")`.
  /@(Controller|Get|GetMapping|RequestMapping|Path|HttpGet)\s*\(\s*(?:path\s*[:=]\s*)?["'`]\/?(health|healthz|livez|readyz|ping|live|ready|readiness|liveness)["'`/]|["'`][A-Za-z0-9_./-]*\/(health|healthz|livez|readyz|ping|_health|liveness|readiness)(\/[a-z0-9_-]+)*["'`]|\/actuator\/health|AddHealthChecks\s*\(|MapHealthChecks\s*\(|IHealthCheck\b|HealthIndicator\b|HealthCheckService|\bhealth_check\b/;
// Deliberately not matching k8s livenessProbe/readinessProbe: those live in
// YAML, and anyCodeMatches only scans source files, so the pattern could never
// fire. A dead pattern that looks like coverage is worse than none.

export function hasHealthCheck(repo: RepoSnapshot): boolean {
  return dependsOnAny(repo, HEALTHCHECK_DEPS) || anyTextMatches(repo, HEALTHCHECK_SYMBOLS);
}
