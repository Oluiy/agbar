import path from "node:path";
import { codeFiles, isClientCode } from "./fileKinds.js";
import type { DetectedFinding, RepoSnapshot, Rule } from "./types.js";

/**
 * Advice in the project's own language. Every rule ships a generic `nextStep`,
 * and for the handful that name specific libraries that generic text is worse
 * than useless: running `check` on Idari (Rust) told it to add
 * `express-rate-limit, @nestjs/throttler, resilience4j` - three libraries it
 * cannot use. A correct finding with unusable advice still wastes the reader's
 * time, which is exactly how a checker loses trust.
 *
 * Only rules whose advice names tools appear here. Everything else (rotate the
 * key, add a LIMIT, split the file) is language-independent and keeps its text.
 */

export type Language = "node" | "python" | "go" | "rust" | "java" | "dotnet" | "ruby" | "php";

const BY_EXTENSION: Record<string, Language> = {
  ".ts": "node",
  ".tsx": "node",
  ".js": "node",
  ".jsx": "node",
  ".mjs": "node",
  ".cjs": "node",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "java",
  ".cs": "dotnet",
  ".rb": "ruby",
  ".php": "php",
};

/** The language of the file a finding points at - its evidence starts "path:line". */
function languageOfEvidence(evidence: string | undefined): Language | undefined {
  if (!evidence) return undefined;
  const filePath = evidence.split(/[\s:]/)[0];
  return BY_EXTENSION[path.extname(filePath).toLowerCase()];
}

/**
 * The language most of this project's server code is written in. Client-side
 * files are excluded: a Rust service with a JavaScript admin page is a Rust
 * project, and its advice should name Rust crates.
 */
export function dominantLanguage(repo: RepoSnapshot): Language | undefined {
  const counts = new Map<Language, number>();
  for (const file of codeFiles(repo)) {
    if (isClientCode(repo, file)) continue;
    const language = BY_EXTENSION[path.extname(file.relPath).toLowerCase()];
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  let best: Language | undefined;
  for (const [language, n] of counts) if (best === undefined || n > counts.get(best)!) best = language;
  return best;
}

/**
 * Per-rule, per-language advice. Each string replaces the rule's generic
 * `nextStep` wholesale, so it has to stand alone: what to do, with the names
 * that ecosystem actually uses.
 */
export const STACK_ADVICE: Record<string, Partial<Record<Language, string>>> = {
  "no-rate-limiting": {
    node: "Add a rate limiter as middleware in front of the routes, not inside individual handlers - express-rate-limit (Express), @fastify/rate-limit (Fastify), or @nestjs/throttler (NestJS). One place, applies everywhere.",
    python:
      "Add a rate limiter at the framework level: slowapi (FastAPI), Flask-Limiter (Flask), or django-ratelimit / DRF's DEFAULT_THROTTLE_RATES (Django). One place, applies to every route.",
    go: "Add a rate-limiting middleware in front of your routes: golang.org/x/time/rate wrapped as middleware, or your router's own (fiber's limiter, echo's middleware.RateLimiter, tollbooth for net/http).",
    rust: "Add a rate-limiting layer to the service, not to each handler: tower-governor plugs into axum/tower as a Layer, built on the governor crate.",
    java: "Add a rate limiter in front of the controllers: Bucket4j (with its Spring Boot starter) or resilience4j-ratelimiter - one filter, applies to every route.",
    dotnet:
      "Use the built-in rate limiter (.NET 7+): builder.Services.AddRateLimiter(...) then app.UseRateLimiter() before routing, so it applies to every endpoint.",
    ruby: "Add Rack::Attack as middleware - it throttles by IP or by any key you choose, in one place ahead of your routes.",
    php: "Add a rate limiter at the framework level: Laravel's throttle middleware on the route group, or symfony/rate-limiter in a listener.",
  },
  "http-without-timeout": {
    node: "Pass an explicit timeout on the call flagged below: fetch(url, { signal: AbortSignal.timeout(3000) }), or axios's timeout option - a default of 'wait forever' is the actual bug.",
    python:
      "Pass a timeout on the call flagged below: requests.get(url, timeout=(3, 10)) (connect, read) or httpx.Client(timeout=5) - requests has no default timeout at all.",
    go: "Don't use http.Get or the default client: build one with a deadline - &http.Client{Timeout: 5 * time.Second} - or pass a context from context.WithTimeout to http.NewRequestWithContext.",
    rust: "Set a timeout when you build the client: reqwest::Client::builder().timeout(Duration::from_secs(5)).build()?, and reuse that client - a per-request tokio::time::timeout also works.",
    java: "Set both timeouts: HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)) for connecting, and .timeout(...) on the HttpRequest for the response. RestTemplate needs a ClientHttpRequestFactory with both.",
    dotnet:
      "Set a deadline on the call: HttpClient.Timeout (default 100s is usually far too long), or pass a CancellationToken from a CancellationTokenSource with a timeout.",
    ruby: "Set both timeouts on the client: Net::HTTP's open_timeout and read_timeout, or Faraday's request: { timeout: 5, open_timeout: 3 } - neither defaults to anything useful.",
    php: "Pass Guzzle's 'timeout' and 'connect_timeout' options on the request (or in the client's defaults) - cURL's default is to wait indefinitely for the response.",
  },
  "no-circuit-breaker": {
    node: "Wrap the outbound call in a circuit breaker - opossum - so a failing dependency gets skipped for a cooldown instead of every request queuing up behind it.",
    python:
      "Wrap the outbound call in a circuit breaker - pybreaker - so a failing dependency gets skipped for a cooldown instead of every request queuing up behind it.",
    go: "Wrap the outbound call in a circuit breaker - sony/gobreaker - so a failing dependency gets skipped for a cooldown instead of every request queuing up behind it.",
    rust: "Wrap the outbound call in a circuit breaker - the failsafe crate, or a small state machine around the client - so a failing dependency is skipped for a cooldown instead of every request queuing behind it.",
    java: "Wrap the outbound call with resilience4j-circuitbreaker (annotation or decorator) so a failing dependency gets skipped for a cooldown instead of every request queuing up behind it.",
    dotnet:
      "Add a circuit-breaker policy with Polly - Microsoft.Extensions.Http.Resilience wires it straight into IHttpClientFactory - so a failing dependency is skipped for a cooldown.",
    ruby: "Wrap the outbound call in a circuit breaker - circuitbox, or Semian for a resource-based one - so a failing dependency gets skipped for a cooldown.",
    php: "Wrap the outbound call in a circuit breaker - ganesha, which has a Guzzle middleware - so a failing dependency gets skipped for a cooldown.",
  },
  "no-connection-pool-config": {
    node: "Create one pool at startup and share it: new Pool({ max: 10 }) from pg, or mysql2's createPool - never a client per request. Size it to the database's connection limit divided by your instance count.",
    python:
      "Configure the pool where the engine is built: create_engine(url, pool_size=10, max_overflow=5) in SQLAlchemy, or psycopg_pool.ConnectionPool - and create it once, not per request.",
    go: "sql.Open already returns a pool - configure it: db.SetMaxOpenConns(10), db.SetMaxIdleConns(5), db.SetConnMaxLifetime(...). For pgx, use pgxpool with MaxConns.",
    rust: "Build the pool once and share it: PgPoolOptions::new().max_connections(10).connect(url) from sqlx (or deadpool), then clone the handle - never open a connection per request.",
    java: "Configure HikariCP (Spring Boot's default): spring.datasource.hikari.maximum-pool-size, sized to the database's real connection limit divided by your instance count.",
    dotnet:
      "Npgsql and SqlClient pool per connection string - set Maximum Pool Size in it, and make sure every connection uses the same string, since a different one means a separate pool.",
    ruby: "Set pool: in database.yml (ActiveRecord) to at least your thread count, sized against the database's real connection limit.",
    php: "Use persistent connections (PDO::ATTR_PERSISTENT) or put PgBouncer in front - PHP's per-request model means the pool usually lives outside the app.",
  },
  "no-schema-migrations": {
    node: "Adopt a migration tool and commit the files: Prisma Migrate, Knex migrations, TypeORM migrations, or node-pg-migrate. Then use expand/contract for anything destructive: add the new column, backfill, write both and read the new one, and drop the old column in a later release.",
    python:
      "Adopt a migration tool and commit the files: Alembic (SQLAlchemy) or Django's built-in migrations. Then use expand/contract for anything destructive: add the new column, backfill, write both and read the new one, and drop the old column in a later release.",
    go: "Adopt a migration tool and commit the files: golang-migrate, goose, or Atlas. Then use expand/contract for anything destructive: add the new column, backfill, write both and read the new one, and drop the old column in a later release.",
    rust: "Adopt a migration tool and commit the files: sqlx migrate (sqlx::migrate! runs them at startup), refinery, or diesel's migrations. Then use expand/contract for anything destructive: add the new column, backfill, write both and read the new one, and drop the old column in a later release.",
    java: "Adopt a migration tool and commit the files: Flyway or Liquibase, both with Spring Boot starters that run on startup. Then use expand/contract for anything destructive: add the new column, backfill, write both and read the new one, and drop the old column in a later release.",
    dotnet:
      "Adopt EF Core migrations and commit them: dotnet ef migrations add <Name>, applied with dotnet ef database update or MigrateAsync() at startup. Then use expand/contract for anything destructive: add the new column, backfill, write both and read the new one, and drop the old column in a later release.",
    ruby: "Use Rails migrations (rails generate migration) and commit them. Then use expand/contract for anything destructive: add the new column, backfill, write both and read the new one, and drop the old column in a later release.",
    php: "Adopt a migration tool and commit the files: Laravel migrations or Doctrine Migrations. Then use expand/contract for anything destructive: add the new column, backfill, write both and read the new one, and drop the old column in a later release.",
  },
};

/**
 * The rule's advice, in this project's language when we have a better version.
 * The language of the file a finding points at wins over the repo's dominant
 * language: in a Go service with one Python script, advice about that script
 * should name Python's tools.
 */
export function adviceFor(rule: Rule, repo: RepoSnapshot, finding: DetectedFinding): string {
  const perLanguage = STACK_ADVICE[rule.id];
  if (!perLanguage) return rule.nextStep;
  const language = languageOfEvidence(finding.evidence) ?? dominantLanguage(repo);
  return (language && perLanguage[language]) ?? rule.nextStep;
}
