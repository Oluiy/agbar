import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BACKEND_CONCEPTS } from "../concepts/index.js";
import { renderCheckReport, renderFixPlan } from "./reportRender.js";
import { scanRepo } from "./repo.js";
import { RULES } from "./rules.js";
import { runCheck } from "./runner.js";
import { STACK_ADVICE } from "./stackAdvice.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "buildquick-check-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function write(relPath: string, contents: string): void {
  const full = path.join(tmpDir, relPath);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, contents, "utf-8");
}

function findingIds(): string[] {
  return runCheck(scanRepo(tmpDir)).findings.map((f) => f.ruleId);
}

/** An Express + Postgres app that passes everything, as the baseline to deviate from. */
function writeCleanApp(): void {
  write(
    "package.json",
    JSON.stringify({
      dependencies: { express: "^4", pg: "^8", "express-rate-limit": "^7", opossum: "^8" },
    })
  );
  write(".gitignore", "node_modules/\n.env\n");
  write("migrations/001_init.sql", "CREATE TABLE items (id SERIAL PRIMARY KEY);");
  write(
    "src/server.js",
    `const express = require("express");
const app = express();
const pool = new Pool({ max: 10 });
app.get("/health", (req, res) => res.send("ok"));
app.get("/items", async (req, res) => {
  const rows = await pool.query("SELECT * FROM items LIMIT $1", [req.query.limit]);
  res.json(rows);
});
async function callUpstream() {
  return fetch("https://api.example.com", { signal: AbortSignal.timeout(5000) });
}
`
  );
}

describe("rule invariants", () => {
  it("every rule points at a concept that actually exists", () => {
    const conceptIds = new Set(BACKEND_CONCEPTS.map((c) => c.id));
    for (const rule of RULES) {
      expect(conceptIds.has(rule.conceptId), `rule '${rule.id}' -> unknown concept '${rule.conceptId}'`).toBe(true);
    }
  });

  it("every rule has a unique id", () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every rule has a non-empty nextStep, distinct from its concept's general fix", () => {
    const fixById = new Map(BACKEND_CONCEPTS.map((c) => [c.id, c.fix]));
    for (const rule of RULES) {
      expect(rule.nextStep.length, `rule '${rule.id}' has no nextStep`).toBeGreaterThan(0);
      expect(rule.nextStep, `rule '${rule.id}' just repeats the concept's fix`).not.toBe(fixById.get(rule.conceptId));
    }
  });

  it("every rule is tagged operational or structural, matching which file it's defined in", () => {
    for (const rule of RULES) {
      expect(["operational", "structural"]).toContain(rule.kind);
    }
    // Spot-check a known rule from each file, so a mistake in the tagging in
    // rules.ts (e.g. the two spreads swapped) is caught directly.
    expect(RULES.find((r) => r.id === "no-rate-limiting")?.kind).toBe("operational");
    expect(RULES.find((r) => r.id === "god-file")?.kind).toBe("structural");
  });

  it("a finding carries its rule's kind and nextStep, not just conceptId", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4" } }));
    write("src/app.js", 'app.get("/health", (r, s) => s.send("ok"));');
    const byId = new Map(RULES.map((r) => [r.id, r]));
    for (const finding of runCheck(scanRepo(tmpDir)).findings) {
      expect(finding.kind).toBe(byId.get(finding.ruleId)!.kind);
      // The rule's own advice - or, for the few rules that name tools, the
      // version written for the project's language (stackAdvice.ts). Never
      // anything else, never empty.
      const allowed = [byId.get(finding.ruleId)!.nextStep, ...Object.values(STACK_ADVICE[finding.ruleId] ?? {})];
      expect(allowed).toContain(finding.nextStep);
      expect(finding.nextStep.length).toBeGreaterThan(0);
    }
  });

  it("a finding always carries the same conceptId as its rule", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4", pg: "^8" } }));
    write("src/app.js", 'const x = await db.query("SELECT * FROM users");');
    const byId = new Map(RULES.map((r) => [r.id, r]));
    for (const finding of runCheck(scanRepo(tmpDir)).findings) {
      expect(finding.conceptId).toBe(byId.get(finding.ruleId)!.conceptId);
    }
  });
});

describe("a clean app", () => {
  it("passes every applicable check", () => {
    writeCleanApp();
    const report = runCheck(scanRepo(tmpDir));
    expect(report.findings).toEqual([]);
    expect(report.passed.length).toBeGreaterThan(0);
  });
});

describe("false positives found running against real code (db-guard)", () => {
  // Regression: "SELECT * FROM t1" inside `CREATE VIEW t1_view AS SELECT * FROM
  // t1;` was flagged as an unbounded runtime query - it's schema DDL, not a query.
  it("does not flag SELECT * inside CREATE VIEW/TABLE/INDEX", () => {
    writeCleanApp();
    write("src/verifier/sqlite.rs", 'conn.execute("CREATE VIEW t1_view AS SELECT * FROM t1;", [])?;');
    expect(findingIds()).not.toContain("unbounded-list-query");
  });

  it("still flags a real unbounded SELECT * that isn't inside a CREATE statement", () => {
    writeCleanApp();
    write("src/repo.rs", 'conn.query("SELECT * FROM users;")?;');
    expect(findingIds()).toContain("unbounded-list-query");
  });

  // query-in-loop still fires (it's a real textual pattern), but no longer
  // asserts "one query per row" as fact when the loop could be over a small,
  // bounded set (collection names, config keys) rather than row-scale data.
  it("query-in-loop no longer overstates certainty about what's being iterated", () => {
    writeCleanApp();
    // loopStart matches .map(/.forEach( (and JS/C-style "for ("), not Rust's
    // "for x in y" - this mirrors how the real match happened, via .map(.
    write(
      "src/verifier/mongo.rs",
      `names.iter().map(|name| {
    db.collection(name).count_documents(None)
});`
    );
    const finding = runCheck(scanRepo(tmpDir)).findings.find((f) => f.ruleId === "query-in-loop");
    expect(finding).toBeDefined();
    expect(finding?.summary).not.toContain("one query per row instead of one query total");
    expect(finding?.nextStep.toLowerCase()).toContain("bounded");
  });
});

describe("no-schema-migrations (unblocked once the schema-migrations concept was written)", () => {
  it("flags a repo with a database and no migrations anywhere", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4", pg: "^8", "express-rate-limit": "^7", opossum: "^8" } }));
    write("src/app.js", 'app.get("/health", (r, s) => s.send("ok"));\nconst pool = new Pool({ max: 10 });');
    expect(findingIds()).toContain("no-schema-migrations");
  });

  it("passes on a migrations directory, whatever the ecosystem's convention is", () => {
    for (const migrationPath of [
      "migrations/001_init.sql",
      "db/migrate/20260101_create_users.rb",
      "alembic/versions/abc123_init.py",
      "prisma/migrations/20260101_init/migration.sql",
      "src/main/resources/db/migration/V1__init.sql",
    ]) {
      const dir = mkdtempSync(path.join(tmpdir(), "buildquick-migrations-"));
      mkdirSync(path.dirname(path.join(dir, migrationPath)), { recursive: true });
      writeFileSync(path.join(dir, migrationPath), "-- migration", "utf-8");
      writeFileSync(path.join(dir, "package.json"), JSON.stringify({ dependencies: { pg: "^8" } }), "utf-8");

      const ids = runCheck(scanRepo(dir)).findings.map((f) => f.ruleId);
      expect(ids, migrationPath).not.toContain("no-schema-migrations");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes when a migration tool is a dependency even with no files committed yet", () => {
    write("package.json", JSON.stringify({ dependencies: { pg: "^8", prisma: "^5" } }));
    expect(findingIds()).not.toContain("no-schema-migrations");
  });

  it("skips entirely on a repo with no database - nothing to migrate", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4", "express-rate-limit": "^7" } }));
    write("src/app.js", 'app.get("/health", (r, s) => s.send("ok"));');
    expect(runCheck(scanRepo(tmpDir)).skipped).toContain("no-schema-migrations");
  });
});

describe("gaps found auditing the whole rule set (not tied to one repo report)", () => {
  it("http-without-timeout: a timeout configured elsewhere in the repo must not silence a call site that has none", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4", "express-rate-limit": "^7" } }));
    write("src/app.js", 'app.get("/health", (r, s) => s.send("ok"));');
    // Timeout config lives in a completely unrelated file - a k8s-style probe,
    // nothing to do with the fetch call below.
    write("config/probe.yaml", "readinessProbe:\n  timeoutSeconds: 5\n");
    write("src/upstream.js", 'async function callUpstream() { return fetch("https://api.example.com"); }');
    expect(findingIds()).toContain("http-without-timeout");
  });

  it("http-without-timeout: still passes when the timeout is actually near the call", () => {
    writeCleanApp(); // includes fetch(... AbortSignal.timeout ...)
    expect(findingIds()).not.toContain("http-without-timeout");
  });

  it("committed-private-key: does not flag AWS's own documented example key", () => {
    writeCleanApp();
    write("README.md", "Your key will look like AKIAIOSFODNN7EXAMPLE");
    write("src/notes.js", "// e.g. AKIAIOSFODNN7EXAMPLE");
    expect(findingIds()).not.toContain("committed-private-key");
  });

  it("committed-private-key: still flags a real-shaped AWS key", () => {
    writeCleanApp();
    write("src/config.js", 'const key = "AKIAABCDEFGH12345678";');
    expect(findingIds()).toContain("committed-private-key");
  });

  it("unbounded-list-query: multi-line CREATE VIEW is still schema, not a runtime query", () => {
    writeCleanApp();
    write(
      "src/schema.rs",
      `conn.execute_batch(
    "CREATE VIEW t1_view AS
     SELECT * FROM t1;",
)?;`
    );
    expect(findingIds()).not.toContain("unbounded-list-query");
  });

  it("too-many-dependencies: fires on Rust's `fn new(...)`, Go's `func New*(...)`, and Python's `__init__`, not just Java/C#/TS constructors", () => {
    writeCleanApp();
    write("src/service.rs", "impl Verifier {\n  fn new(a: A, b: B, c: C, d: D, e: E, f: F, g: G) -> Self { todo!() }\n}");
    expect(findingIds()).toContain("too-many-dependencies");
  });

  it("handler-touches-database: fires on a non-JS/TS handler file (handler.rs), not just handler.js/.ts", () => {
    write("package.json", JSON.stringify({ dependencies: { pg: "^8" } }));
    write("src/api/handler.rs", 'conn.query("SELECT id FROM users WHERE id = $1", &[&id])?;');
    expect(findingIds()).toContain("handler-touches-database");
  });
});

describe("expanded coverage: hardcoded-db-credentials, no-circuit-breaker, in-memory-session-store", () => {
  it("flags a real embedded credential, ignores common placeholder forms", () => {
    writeCleanApp();
    write("src/db.js", 'const url = "postgres://admin:S3cr3tP4ss@db.prod.internal:5432/app";');
    expect(findingIds()).toContain("hardcoded-db-credentials");
  });

  it("does not flag placeholder credentials (password, changeme, <password>, env interpolation)", () => {
    for (const line of [
      'const url = "postgres://user:password@localhost/dev";',
      'const url = "mongodb://user:changeme@localhost/test";',
      "# e.g. postgres://user:<password>@host/db",
      "const url = `postgres://user:${DB_PASSWORD}@localhost/app`;",
    ]) {
      const dir = mkdtempSync(path.join(tmpdir(), "buildquick-check-test-"));
      writeFileSync(path.join(dir, "src.js"), line, "utf-8");
      const report = runCheck(scanRepo(dir));
      expect(
        report.findings.map((f) => f.ruleId),
        line
      ).not.toContain("hardcoded-db-credentials");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("flags an outbound call with no circuit breaker, passes once one is present", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4", "express-rate-limit": "^7" } }));
    write("src/app.js", 'app.get("/health", (r, s) => s.send("ok"));\nfetch("https://api.example.com");');
    expect(findingIds()).toContain("no-circuit-breaker");
    writeCleanApp(); // adds opossum
    expect(findingIds()).not.toContain("no-circuit-breaker");
  });

  it("skips no-circuit-breaker entirely when there's no outbound HTTP at all", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4", "express-rate-limit": "^7" } }));
    write("src/app.js", 'app.get("/health", (r, s) => s.send("ok"));');
    expect(runCheck(scanRepo(tmpDir)).skipped).toContain("no-circuit-breaker");
  });

  it("flags express-session with no external store, passes with one configured", () => {
    write("package.json", JSON.stringify({ dependencies: { "express-session": "^1" } }));
    expect(findingIds()).toContain("in-memory-session-store");

    write("package.json", JSON.stringify({ dependencies: { "express-session": "^1", "connect-redis": "^7" } }));
    expect(findingIds()).not.toContain("in-memory-session-store");
  });

  it("skips in-memory-session-store entirely when express-session isn't used", () => {
    writeCleanApp();
    expect(runCheck(scanRepo(tmpDir)).skipped).toContain("in-memory-session-store");
  });
});

describe("rules fire on real problems", () => {
  it("flags a .env that .gitignore doesn't cover, and stays quiet when it does", () => {
    writeCleanApp();
    write(".env", "DB_PASSWORD=hunter2");
    expect(findingIds()).not.toContain("env-not-ignored"); // .gitignore already lists .env

    write(".gitignore", "node_modules/\n");
    expect(findingIds()).toContain("env-not-ignored");
  });

  it("a nested .gitignore covers a nested .env even with no root .gitignore at all", () => {
    writeCleanApp();
    write("apps/api/.env", "DB_PASSWORD=hunter2");
    write("apps/api/.gitignore", "node_modules/\n.env\n");
    expect(findingIds()).not.toContain("env-not-ignored");
  });

  it("still flags a nested .env when no .gitignore at any level actually covers it", () => {
    // Deliberately not writeCleanApp() - its root .gitignore already contains a
    // bare ".env" pattern, which correctly matches at any depth per real
    // gitignore semantics, so it would cover this file too. This case needs a
    // root .gitignore that doesn't mention .env at all.
    write("package.json", JSON.stringify({ dependencies: { express: "^4" } }));
    write(".gitignore", "node_modules/\n");
    write("apps/api/.env", "DB_PASSWORD=hunter2");
    write("apps/api/.gitignore", "node_modules/\n"); // present, but doesn't mention .env either
    expect(findingIds()).toContain("env-not-ignored");
  });

  it("flags a committed private key", () => {
    writeCleanApp();
    write("config/key.pem", "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----");
    expect(findingIds()).toContain("committed-private-key");
  });

  it("flags a missing rate limiter on an HTTP service", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4" } }));
    write("src/app.js", 'app.get("/health", (r, s) => s.send("ok"));');
    expect(findingIds()).toContain("no-rate-limiting");
  });

  it("flags a missing health endpoint", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4", "express-rate-limit": "^7" } }));
    write("src/app.js", 'app.get("/items", (r, s) => s.json([]));');
    expect(findingIds()).toContain("no-healthcheck");
  });

  it("isn't fooled by an unrelated lodash throttle into thinking a limiter exists", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4", lodash: "^4" } }));
    write("src/app.js", 'import { throttle } from "lodash";\nconst f = throttle(fn, 200);\napp.get("/health", (r, s) => s.send("ok"));');
    expect(findingIds()).toContain("no-rate-limiting");
  });

  it("isn't fooled by a websocket heartbeat into thinking a health endpoint exists", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4", "express-rate-limit": "^7" } }));
    write("src/app.js", 'socket.emit("ping");\nsocket.on("ping", () => socket.emit("pong"));\napp.get("/items", (r, s) => s.json([]));');
    expect(findingIds()).toContain("no-healthcheck");
  });

  it("accepts a real limiter symbol as evidence even with no limiter package declared", () => {
    // A NestJS app pulls @Throttle in via @nestjs/throttler, but a repo can also
    // wire a limiter by hand. The symbol is the evidence, not just the manifest.
    write("package.json", JSON.stringify({ dependencies: { express: "^4" } }));
    write("src/app.js", 'app.use(rateLimit({ windowMs: 60000, max: 100 }));\napp.get("/health", (r, s) => s.send("ok"));');
    expect(findingIds()).not.toContain("no-rate-limiting");
  });

  it("counts a health endpoint mounted under a prefix, not just at the path root", () => {
    // /api/health and /v1/internal/health are how real services mount this far
    // more often than a bare /health. Requiring the path to start with the
    // health segment reported those services as having no health endpoint.
    write("package.json", JSON.stringify({ dependencies: { express: "^4", "express-rate-limit": "^7" } }));
    write("src/app.js", 'app.get("/api/health", (r, s) => s.send("ok"));');
    expect(findingIds()).not.toContain("no-healthcheck");
  });

  it("doesn't mistake a size or concurrency limiter for a request rate limiter", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4" } }));
    write("src/app.js", 'const q = new ConcurrencyLimiter(4);\napp.get("/health", (r, s) => s.send("ok"));');
    expect(findingIds()).toContain("no-rate-limiting");
  });

  it("treats Django REST Framework as rate-limited only once throttle rates are configured", () => {
    // DRF ships throttling classes but leaves them off, so the dependency alone
    // proves nothing - only the settings that actually switch them on do.
    write("requirements.txt", "django\ndjangorestframework\n");
    write("app/views.py", 'urlpatterns = []\n\n@app.get("/health")\ndef health(): pass\n');
    expect(findingIds()).toContain("no-rate-limiting");

    write("app/settings.py", 'REST_FRAMEWORK = {"DEFAULT_THROTTLE_RATES": {"anon": "100/day"}}');
    expect(findingIds()).not.toContain("no-rate-limiting");
  });

  it("skips both HTTP-only rules for a library that merely depends on a web framework", () => {
    // express as a dependency with no server and no routes: a middleware package
    // or a test helper. Flagging it for a missing limiter would be noise.
    write("package.json", JSON.stringify({ dependencies: { express: "^4" } }));
    write("src/index.js", "export function middleware(req, res, next) { next(); }");
    const report = runCheck(scanRepo(tmpDir));
    expect(report.skipped).toContain("no-rate-limiting");
    expect(report.skipped).toContain("no-healthcheck");
  });

  it("flags an unbounded list query", () => {
    writeCleanApp();
    write("src/repo.js", "const all = await userRepository.findAll();");
    expect(findingIds()).toContain("unbounded-list-query");
  });

  it("flags a database call inside a loop", () => {
    writeCleanApp();
    write(
      "src/orders.js",
      `for (const order of orders) {
  const customer = await repository.findById(order.customerId);
}`
    );
    expect(findingIds()).toContain("query-in-loop");
  });

  it("flags outbound HTTP with no timeout anywhere", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4", "express-rate-limit": "^7" } }));
    write("src/app.js", 'app.get("/health", (r, s) => s.send("ok"));\nconst r = await fetch("https://api.example.com");');
    expect(findingIds()).toContain("http-without-timeout");
  });

  it("flags missing connection pool config", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4", pg: "^8", "express-rate-limit": "^7" } }));
    write("src/app.js", 'app.get("/health", (r, s) => s.send("ok"));\nconst c = new Client();');
    expect(findingIds()).toContain("no-connection-pool-config");
  });
});

describe("scoping", () => {
  it("skips database rules entirely on a repo with no database", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4", "express-rate-limit": "^7" } }));
    write("src/app.js", 'app.get("/health", (r, s) => s.send("ok"));');
    const report = runCheck(scanRepo(tmpDir));
    expect(report.skipped).toContain("no-connection-pool-config");
    expect(report.skipped).toContain("query-in-loop");
    expect(report.findings.map((f) => f.ruleId)).not.toContain("unbounded-list-query");
  });

  it("ignores test files, which legitimately do things production code shouldn't", () => {
    writeCleanApp();
    write("src/__tests__/users.test.js", "const all = await userRepository.findAll();");
    expect(findingIds()).not.toContain("unbounded-list-query");
  });

  // Regression: this fired on buildquick's own test fixtures the first time it was
  // run against a real repo.
  it("does not flag fake key material in a test file", () => {
    writeCleanApp();
    write("src/check.test.js", 'const fake = "-----BEGIN RSA PRIVATE KEY-----";');
    expect(findingIds()).not.toContain("committed-private-key");
  });

  it("still flags a real key file even when it sits under a test directory", () => {
    writeCleanApp();
    write("tests/fixtures/server.pem", "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----");
    expect(findingIds()).toContain("committed-private-key");
  });

  // Regression: this fired on freshly scaffolded Spring Boot, which ships HikariCP.
  it("does not claim missing pooling for frameworks that pool by default", () => {
    write("pom.xml", "<project><dependencies>spring-boot-starter-data-jpa postgresql</dependencies></project>");
    write("src/App.java", 'class App { void health() { "/health"; } }');
    const report = runCheck(scanRepo(tmpDir));
    expect(report.skipped).toContain("no-connection-pool-config");
  });

  it("sorts findings high severity first", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4", pg: "^8" } }));
    write(".env", "SECRET=x");
    write(".gitignore", "node_modules/\n");
    write("src/app.js", "const all = await repo.findAll();");
    const severities = runCheck(scanRepo(tmpDir)).findings.map((f) => f.severity);
    expect(severities[0]).toBe("high");
  });

  it("throws a clear error for a path that doesn't exist", () => {
    expect(() => scanRepo(path.join(tmpDir, "nope"))).toThrow(/No such directory/);
  });
});

describe("evidence for absence-checks (no single line to point to)", () => {
  it("no-rate-limiting points at where the app is set up", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4" } }));
    write("src/app.js", 'const app = express();\napp.get("/health", (r, s) => s.send("ok"));');
    const finding = runCheck(scanRepo(tmpDir)).findings.find((f) => f.ruleId === "no-rate-limiting");
    expect(finding?.evidence).toContain("app.js:1");
  });

  it("no-healthcheck points at where the app is set up", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4", "express-rate-limit": "^7" } }));
    write("src/app.js", "const app = express();");
    const finding = runCheck(scanRepo(tmpDir)).findings.find((f) => f.ruleId === "no-healthcheck");
    expect(finding?.evidence).toContain("app.js:1");
  });

  it("no-connection-pool-config points at the raw client being constructed", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4", pg: "^8", "express-rate-limit": "^7" } }));
    write("src/app.js", 'app.get("/health", (r, s) => s.send("ok"));\nconst c = new Client();');
    const finding = runCheck(scanRepo(tmpDir)).findings.find((f) => f.ruleId === "no-connection-pool-config");
    expect(finding?.evidence).toContain("new Client()");
  });

  it("degrades to no evidence, not a crash, when nothing to point at is found", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4" } }));
    write("src/app.js", 'app.get("/health", (r, s) => s.send("ok"));'); // no express() call anywhere
    const finding = runCheck(scanRepo(tmpDir)).findings.find((f) => f.ruleId === "no-rate-limiting");
    expect(finding).toBeDefined();
    expect(finding?.evidence).toBeUndefined();
  });
});

describe("god-file comparative context", () => {
  it("states the next-largest file and median, not just the threshold", () => {
    write("package.json", "{}");
    write("src/small.js", Array(20).fill("x();").join("\n"));
    write("src/big.js", Array(600).fill("x();").join("\n"));
    const finding = runCheck(scanRepo(tmpDir)).findings.find((f) => f.ruleId === "god-file");
    expect(finding?.summary).toContain("600 lines");
    expect(finding?.summary).toContain("next-largest file in this repo is 20 lines");
  });

  it("degrades cleanly with only one file - no comparison to make", () => {
    write("package.json", "{}");
    write("src/only.js", Array(600).fill("x();").join("\n"));
    const finding = runCheck(scanRepo(tmpDir)).findings.find((f) => f.ruleId === "god-file");
    expect(finding?.summary).toContain("600 lines");
    expect(finding?.summary).not.toContain("next-largest");
  });
});

describe("renderFixPlan", () => {
  it("says there's nothing to fix when everything passes", () => {
    writeCleanApp();
    expect(renderFixPlan(runCheck(scanRepo(tmpDir)), false)).toContain("Nothing to fix");
  });

  it("renders findings as a checklist grouped by section, each item carrying its next step", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4", pg: "^8" } }));
    write(".env", "SECRET=x");
    write(".gitignore", "node_modules/\n");
    write("src/app.js", "const all = await repo.findAll();");

    const plan = renderFixPlan(runCheck(scanRepo(tmpDir)), false);
    expect(plan).toContain("- [ ]");
    expect(plan).toContain("## Will this survive traffic?");
    expect(plan.toLowerCase()).toContain("rotate");
  });

  // Regression: --explain and --fix-plan combined used to silently drop --explain,
  // since checkCommand.ts picked one renderer or the other with no way to pass
  // the flag through to whichever one wasn't chosen.
  it("includes the concept's fix per item when explain is true, and omits it when false", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4" } }));
    write(".env", "SECRET=x");
    write(".gitignore", "node_modules/\n");

    const report = runCheck(scanRepo(tmpDir));
    const fix = BACKEND_CONCEPTS.find((c) => c.id === "secrets-management")!.fix;
    expect(renderFixPlan(report, true)).toContain(fix);
    expect(renderFixPlan(report, false)).not.toContain(fix);
  });
});

describe("empty directory", () => {
  it("scanRepo on a genuinely empty directory finds nothing to run rules against", () => {
    const repo = scanRepo(tmpDir);
    expect(repo.allPaths).toEqual([]);
  });

  // Regression: committed-private-key and hardcoded-db-credentials both apply
  // unconditionally (appliesTo: () => true), so "applicable === 0" can never
  // actually happen once runCheck runs - an empty directory used to just report
  // "N/N checks passed," which reads as "this was checked and is fine" rather
  // than "there was nothing here."
  it("running check on it would report a false 'N/N passed' rather than 'nothing here' without an explicit guard", () => {
    const repo = scanRepo(tmpDir);
    const report = runCheck(repo);
    expect(new Set(report.passed)).toEqual(new Set(["committed-private-key", "hardcoded-db-credentials"]));
    expect(report.passed.length + report.findings.length).toBeGreaterThan(0); // so the dead applicable===0 branch never fires
  });
});

describe("terminal readability: severity counts and stable numbering", () => {
  function multiFindingReport() {
    write("package.json", JSON.stringify({ dependencies: { express: "^4", pg: "^8" } }));
    write(".env", "SECRET=x"); // high: env-not-ignored
    write(".gitignore", "node_modules/\n");
    write("src/app.js", "const all = await repo.findAll();"); // medium: unbounded-list-query + no-rate-limiting + no-healthcheck
    return runCheck(scanRepo(tmpDir));
  }

  it("shows a severity breakdown line above the detailed findings", () => {
    const rendered = renderCheckReport(multiFindingReport(), tmpDir, false);
    expect(rendered).toMatch(/1 high/);
    expect(rendered).toMatch(/\d+ medium/);
  });

  it("numbers findings 1..N in the same order they're grouped, and renderFixPlan uses the identical numbers", () => {
    const report = multiFindingReport();
    const narrative = renderCheckReport(report, tmpDir, false);
    const plan = renderFixPlan(report, false);

    expect(narrative).toContain("1.");
    // Whatever finding narrative labels "#1" internally, the checklist must
    // reference the same finding as #1 - cross-referencing only works if the
    // numbering is derived from one shared order, not computed twice.
    const firstNarrativeSummary = report.findings[0].summary.slice(0, 30);
    expect(narrative.indexOf("1.")).toBeLessThan(narrative.indexOf(firstNarrativeSummary));
    expect(plan).toContain(`#1 (${report.findings[0].severity})`);
  });
});

describe("false positives found running against Idari and ai-cost-guard", () => {
  it("code inside strings is not code: an analyzer's lookup tables and fixtures don't trigger rules", () => {
    // Idari (a code analyzer) keeps other languages' API names as data.
    write("Cargo.toml", '[dependencies]\naxum = "0.8"\nrusqlite = "0.31"\n');
    write("src/tables.rs", 'const HTTP: &[&str] = &["axios.get", "fetch"];\nconst DB: &[&str] = &["DriverManager.getConnection"];\n');
    write("src/fixture.rs", 'let old = "var b = WebApplication.CreateBuilder(args);";\n');
    const ids = findingIds();
    expect(ids).not.toContain("http-without-timeout");
    expect(ids).not.toContain("no-circuit-breaker");
    expect(ids).not.toContain("no-connection-pool-config");
    expect(ids).not.toContain("no-healthcheck"); // the fixture string no longer makes it an HTTP service
  });

  it("a HashMap lookup inside a loop is not a database query", () => {
    write("Cargo.toml", '[dependencies]\nrusqlite = "0.31"\n');
    write("migrations/001.sql", "CREATE TABLE t (id INTEGER);");
    write("src/diff.rs", "for e in edges.iter().map(|e| {\n    old_by_id.get(e.src.as_str())\n}) {}\n");
    expect(findingIds()).not.toContain("query-in-loop");
  });

  it("Go and Python test-file conventions are recognized as tests", () => {
    write("go.mod", "module x\nrequire github.com/redis/go-redis/v9 v9.0.0\n");
    write("internal/cli/run_test.go", 'maskRedisURL("redis://default:supersecretpassword@host:6379/0")\n');
    write("tests_x/test_db.py", 'URL = "postgres://app:realpass@db/x"\n');
    expect(findingIds()).not.toContain("hardcoded-db-credentials");

    write("internal/cli/run.go", 'dsn := "postgres://app:realpass@db/x"\n');
    expect(findingIds()).toContain("hardcoded-db-credentials");
  });

  it("browser code calling its own backend isn't asked for a server-side timeout", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4" } }));
    write("internal/dashboard/static/js/dashboard.js", 'return fetch("/dashboard/api/data");\n');
    expect(findingIds()).not.toContain("http-without-timeout");
  });

  it("a Fiber service and a net/http service are both recognized as HTTP services", () => {
    write("go.mod", "module x\nrequire github.com/gofiber/fiber/v2 v2.52.0\n");
    write("main.go", 'app := fiber.New()\napp.Get("/items", h)\n');
    expect(findingIds()).toContain("no-healthcheck");

    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    write("go.mod", "module x\n");
    write("main.go", 'package main\n\nimport (\n\t"net/http"\n)\n\nfunc main() { http.ListenAndServe(":8080", nil) }\n');
    expect(findingIds()).toContain("no-healthcheck");
  });

  it("the timeout finding teaches timeouts", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4" } }));
    write("src/app.js", 'const r = await fetch("https://api.example.com");\n');
    expect(runCheck(scanRepo(tmpDir)).findings.find((f) => f.ruleId === "http-without-timeout")?.conceptId).toBe("timeouts");
  });

  it("an embedded SQLite database isn't told to configure a connection pool", () => {
    write("go.mod", "module x\nrequire modernc.org/sqlite v1.0.0\n");
    write("store.go", 'db, _ := sql.Open("sqlite", path)\n');
    expect(runCheck(scanRepo(tmpDir)).skipped).toContain("no-connection-pool-config");
  });

  it("a schema created in code is described accurately, with the IF NOT EXISTS trap", () => {
    write("go.mod", "module x\nrequire modernc.org/sqlite v1.0.0\n");
    write("store.go", "const schema = `CREATE TABLE IF NOT EXISTS requests (id INTEGER)`\n");
    const f = runCheck(scanRepo(tmpDir)).findings.find((x) => x.ruleId === "no-schema-migrations");
    expect(f?.summary).toMatch(/never alters a table that already exists/);
    expect(f?.evidence).toContain("store.go:1");
  });

  it('{"kind": "cli"} in .buildquickrc skips production-service checks, and says so', () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4" } }));
    write("src/app.js", 'app.get("/items", (r, s) => s.json([]));');
    write(".buildquickrc", JSON.stringify({ kind: "local-tool" }));
    const report = runCheck(scanRepo(tmpDir));
    expect(report.findings.map((f) => f.ruleId)).not.toContain("no-rate-limiting");
    expect(report.skippedForKind).toEqual(expect.arrayContaining(["no-rate-limiting", "no-healthcheck"]));
    expect(renderCheckReport(report, tmpDir, false)).toMatch(/production-service check\(s\) skipped/);
  });

  it("a typo'd kind fails loudly instead of silently running every rule", () => {
    write(".buildquickrc", JSON.stringify({ kind: "clii" }));
    expect(() => scanRepo(tmpDir)).toThrow(/"kind" must be one of/);
  });
});

describe("false positives found running against impact.pulse and MzuriSourceCode", () => {
  it("a timeout on a later line of a multi-line call counts", () => {
    write("requirements.txt", "requests\n");
    write("ingestion/api_client.py", 'r = requests.post(\n    f"{BASE}/auth/login",\n    data={"u": u, "p": p},\n    timeout=90,\n)\n');
    expect(findingIds()).not.toContain("http-without-timeout");
  });

  it("a C# method named Fetch is not an outbound HTTP call", () => {
    write("Repo.cs", "public IQueryable<T> Fetch(Expression<Func<T, bool>> predicate) { return _set.Where(predicate); }\n");
    expect(findingIds()).not.toContain("http-without-timeout");
  });

  it("generated code (EF Core migration designers) isn't graded", () => {
    write("Migrations/20260814_Add.Designer.cs", "// <auto-generated />\n" + "x();\n".repeat(900));
    expect(findingIds()).not.toContain("god-file");
  });

  it(".csproj dependencies are read - .NET services get the database and HTTP rules", () => {
    write(
      "Api/Api.csproj",
      '<Project><ItemGroup><PackageReference Include="Microsoft.AspNetCore.OpenApi" /><PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL" /></ItemGroup></Project>'
    );
    write("Api/Program.cs", "var builder = WebApplication.CreateBuilder(args);\nvar app = builder.Build();\napp.Run();\n");
    const report = runCheck(scanRepo(tmpDir));
    expect(report.skipped).not.toContain("no-healthcheck");
    expect(report.skipped).not.toContain("no-schema-migrations");
  });
});

describe("false positives and misses found running against 11 more real repos", () => {
  it("manifest prose isn't a dependency: a CLI whose description mentions PostgreSQL isn't a DB app", () => {
    write(
      "Tool.csproj",
      '<Project><PropertyGroup><Description>Scaffolds ASP.NET Core apps with PostgreSQL</Description></PropertyGroup><ItemGroup><PackageReference Include="Spectre.Console" /></ItemGroup></Project>'
    );
    write("package.json", JSON.stringify({ description: "an express and postgres starter", dependencies: { chalk: "^5" } }));
    write("Program.cs", "Console.WriteLine(1);");
    const report = runCheck(scanRepo(tmpDir));
    expect(report.skipped).toEqual(expect.arrayContaining(["no-schema-migrations", "no-rate-limiting"]));
  });

  it("a code generator's C# raw-string template doesn't make it an HTTP service", () => {
    write("Gen.csproj", '<Project><ItemGroup><PackageReference Include="Microsoft.AspNetCore.OpenApi" /></ItemGroup></Project>');
    write("Templates/ProgramTemplate.cs", 'return $$"""\n    var builder = WebApplication.CreateBuilder(args);\n    """;\n');
    expect(runCheck(scanRepo(tmpDir)).skipped).toContain("no-rate-limiting");
  });

  it("every JS/TS file in a Vite/React app is client code - but Next.js route handlers are server code", () => {
    write("package.json", JSON.stringify({ dependencies: { react: "^18", axios: "^1" }, devDependencies: { vite: "^5" } }));
    write("src/api/client.ts", "export const api = axios.create({ baseURL });\n");
    expect(findingIds()).not.toContain("http-without-timeout");

    write("package.json", JSON.stringify({ dependencies: { next: "^14", react: "^18" } }));
    write("app/api/sync/route.ts", 'export async function GET() { return fetch("https://upstream.example.com"); }\n');
    expect(findingIds()).toContain("http-without-timeout");
  });

  it("Rust tests after #[cfg(test)], or in *_tests.rs, are test code", () => {
    write("Cargo.toml", '[dependencies]\ntokio = "1"\n');
    write("src/drill.rs", 'fn run() {}\n#[cfg(test)]\nmod tests {\n    const URL: &str = "postgresql://app:hunter2@h:5432/db";\n}\n');
    expect(findingIds()).not.toContain("hardcoded-db-credentials");

    write("src/drill.rs", 'const URL: &str = "postgresql://app:hunter2@h:5432/db";\n');
    expect(findingIds()).toContain("hardcoded-db-credentials");
  });

  it("test fixtures in *_tests.rs can't make a server without a health route look healthy", () => {
    write("Cargo.toml", '[dependencies]\naxum = "0.8"\n');
    write("src/web.rs", "let app = Router::new();\n");
    write("src/http_tests.rs", 'let fixture = r#"[HttpPost("/health")]"#;\nlet p = "/health";\n');
    expect(findingIds()).toContain("no-healthcheck");
  });

  it("a one-letter password in a URL is a placeholder", () => {
    write("go.mod", "module x\n");
    write("main.go", 'dsn := "postgresql://u:p@h:5432/db"\n');
    expect(findingIds()).not.toContain("hardcoded-db-credentials");
  });

  it("vendored shadcn/ui components aren't graded as the repo's own code", () => {
    write("package.json", JSON.stringify({ dependencies: { react: "^18" } }));
    write("src/components/ui/sidebar.tsx", 'import { Slot } from "@radix-ui/react-slot";\n' + "x();\n".repeat(800));
    expect(findingIds()).not.toContain("god-file");
  });
});

describe("the report says where to start", () => {
  it("names the most severe finding's number - even when numbering puts it after a milder one", () => {
    // Operational findings are numbered first; here the only operational one is LOW
    // and the structural one is MEDIUM, so "#1" would be the wrong advice.
    write("package.json", JSON.stringify({ dependencies: { express: "^4", pg: "^8", "express-rate-limit": "^7" } }));
    write("migrations/001.sql", "CREATE TABLE a (id int);");
    write(
      "src/server.js",
      'const app = express();\napp.get("/health", (r, s) => s.send("ok"));\nconst pool = new Pool({ max: 5 });\nconst r = await axios.get("https://x.example.com", { timeout: 5000 });\n'
    );
    write("src/controllers/userController.js", 'const rows = await pool.query("SELECT id FROM users LIMIT 10");\n');
    const report = runCheck(scanRepo(tmpDir));
    const text = renderCheckReport(report, tmpDir, false).replace(/\x1b\[[0-9;]*m/g, "");
    const numbered = [...text.matchAll(/^(\d+)\.\s+(HIGH|MEDIUM|LOW)/gm)].map((m) => ({ n: m[1], sev: m[2] }));
    const worst = numbered.find((f) => f.sev === "HIGH") ?? numbered.find((f) => f.sev === "MEDIUM") ?? numbered[0];
    expect(text).toContain(`Start with #${worst.n}`);
  });
});

describe("escaped template placeholders (found by buildquick checking its own source)", () => {
  it("\\${VAR:-default} inside a TS template string is a placeholder, not a hardcoded password", () => {
    write("package.json", '{"dependencies":{"express":"5"}}');
    write("src/templates/compose.ts", "const y = `\n      DATABASE_URL: postgres://postgres:\\${POSTGRES_PASSWORD:-postgres}@db:5432/app\n`;\n");
    expect(findingIds()).not.toContain("hardcoded-db-credentials");
  });

  it("but a real password in the same shape is still reported", () => {
    write("package.json", '{"dependencies":{"express":"5"}}');
    write("src/db.ts", 'const url = "postgres://appuser:Xk9mQ2vLp7@db.internal:5432/app";\n');
    expect(findingIds()).toContain("hardcoded-db-credentials");
  });
});

describe("held-out batch 2 false positives", () => {
  const GO_WEB = "module x\nrequire github.com/gin-gonic/gin v1.9.0\n";

  it("a Go method named fetch is not an HTTP call - global fetch is JavaScript-only - but http.Get still is", () => {
    write("go.mod", GO_WEB);
    write("main.go", 'package main\nfunc main() { r := gin.Default(); r.GET("/a", h); r.Run() }\n');
    write("repo.go", "package main\nfunc (m *Repo) fetch(ctx context.Context, query string) ([]Row, error) {\n\treturn nil, nil\n}\n");
    expect(findingIds()).not.toContain("http-without-timeout");
    write("client.go", 'package main\nfunc call() { resp, _ := http.Get("https://api.example.org/x"); _ = resp }\n');
    expect(findingIds()).toContain("http-without-timeout");
  });

  it("JavaScript's global fetch is still flagged", () => {
    write("package.json", '{"dependencies":{"express":"5"}}');
    write(
      "src/app.ts",
      'import express from "express";\nconst app = express();\napp.get("/a", async () => { await fetch("https://api.example.org/x"); });\napp.listen(3000);\n'
    );
    expect(findingIds()).toContain("http-without-timeout");
  });

  it("a query loop in a dev_utils helper is a one-off, not an N+1 on a request path", () => {
    write("Cargo.toml", '[dependencies]\naxum = "0.8"\nsqlx = "0.9"\n');
    write("migrations/1.sql", "select 1");
    write("crates/lib-core/src/_dev_utils/dev_db.rs", "async fn pexec(db: &Db) {\n\tfor sql in sqls {\n\t\tsqlx::query(sql).execute(db).await;\n\t}\n}\n");
    expect(findingIds()).not.toContain("query-in-loop");
  });

  it("the same loop outside a dev helper is still flagged", () => {
    write("Cargo.toml", '[dependencies]\naxum = "0.8"\nsqlx = "0.9"\n');
    write("migrations/1.sql", "select 1");
    write("src/handlers.rs", 'async fn load(db: &Db, ids: Vec<i64>) {\n\tfor id in ids {\n\t\tsqlx::query("select 1").execute(db).await;\n\t}\n}\n');
    expect(findingIds()).toContain("query-in-loop");
  });

  it("a long tool config (.dependency-cruiser.js, *.config.js) is not a god-file, but a long source file is", () => {
    write("package.json", '{"dependencies":{"express":"5"}}');
    write(".dependency-cruiser.js", `module.exports = {\n${"  rule: {},\n".repeat(900)}};\n`);
    write("webpack.config.js", `module.exports = {\n${"  x: 1,\n".repeat(900)}};\n`);
    expect(findingIds()).not.toContain("god-file");
    write("src/service.js", `${"export const x = 1;\n".repeat(900)}`);
    expect(findingIds()).toContain("god-file");
  });
});

describe("held-out repo false positives (found on repos never used to tune the rules)", () => {
  const GO_WEB = "module x\nrequire github.com/gin-gonic/gin v1.9.0\n";

  it("sqlx's .fetch(&pool) is a database call, not an HTTP call without a timeout - but a bare fetch(url) still is", () => {
    write("Cargo.toml", '[dependencies]\naxum = "0.7"\n');
    write("src/main.rs", 'async fn f(ctx: &Ctx) {\n    let rows = sqlx::query("select 1")\n        .fetch(&ctx.db);\n}\n');
    expect(findingIds()).not.toContain("http-without-timeout");
    write("package.json", '{"dependencies":{"express":"4"}}');
    write(
      "src/app.ts",
      'import express from "express";\nconst app = express();\napp.get("/a", async () => { await fetch("https://api.example.org/x"); });\napp.listen(3000);\n'
    );
    expect(findingIds()).toContain("http-without-timeout");
  });

  it("a Go mock key in an apitest/ helper package is a fixture, not a committed key", () => {
    write("go.mod", GO_WEB);
    write("app/sdk/apitest/keystore.go", "package apitest\nconst k = `-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----`\n");
    expect(findingIds()).not.toContain("committed-private-key");
    write("app/sdk/keys/keystore.go", "package keys\nconst k = `-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----`\n");
    expect(findingIds()).toContain("committed-private-key");
  });

  it("'latest/' is not a test folder", () => {
    write("go.mod", GO_WEB);
    write("app/latest/keystore.go", "package latest\nconst k = `-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----`\n");
    expect(findingIds()).toContain("committed-private-key");
  });

  it("Go /liveness and /readiness routes count as health checks", () => {
    write("go.mod", GO_WEB);
    write("main.go", 'package main\nfunc main() {\n  r := gin.Default()\n  r.GET("/v1/readiness", h)\n  r.Run()\n}\n');
    expect(findingIds()).not.toContain("no-healthcheck");
  });

  it("ardanlabs/darwin counts as a migration tool", () => {
    write("go.mod", "module x\nrequire (\n github.com/ardanlabs/darwin/v3 v3.0.0\n github.com/jackc/pgx/v5 v5.0.0\n)\n");
    write("main.go", "package main\nfunc main() {}\n");
    expect(findingIds()).not.toContain("no-schema-migrations");
  });

  it("Java Optional.map is not a loop, but stream().map is", () => {
    write("pom.xml", "<project><dependencies><dependency><artifactId>spring-boot-starter-data-jpa</artifactId></dependency></dependencies></project>");
    write("migrations/1.sql", "select 1");
    write(
      "src/main/java/a/Api.java",
      "class Api {\n  Object f(String n) {\n    return repo.findByName(n)\n      .map(t -> {\n        return repo.findById(t.getId());\n      }).orElseThrow();\n  }\n}\n"
    );
    expect(findingIds()).not.toContain("query-in-loop");
    write(
      "src/main/java/a/Api.java",
      "class Api {\n  Object f(java.util.List<Long> ids) {\n    return ids.stream().map(id -> {\n      return repo.findById(id);\n    });\n  }\n}\n"
    );
    expect(findingIds()).toContain("query-in-loop");
  });
});

describe("AdonisJS (found by grading buildquick's own Adonis scaffold)", () => {
  const routes = "import router from '@adonisjs/core/services/router'\nrouter.get('/api/v1/items', [ItemsController, 'index'])\n";

  it("an Adonis API counts as an HTTP service, so a missing limiter and health check are flagged", () => {
    write("package.json", JSON.stringify({ dependencies: { "@adonisjs/core": "7.5.2" } }));
    write("start/routes.ts", routes);
    const ids = findingIds();
    expect(ids).toContain("no-rate-limiting");
    expect(ids).toContain("no-healthcheck");
  });

  it("@adonisjs/limiter and a /health route satisfy both", () => {
    write("package.json", JSON.stringify({ dependencies: { "@adonisjs/core": "7.5.2", "@adonisjs/limiter": "3.0.0" } }));
    write("start/routes.ts", `${routes}router.get('/health', [HealthController, 'live'])\n`);
    const ids = findingIds();
    expect(ids).not.toContain("no-rate-limiting");
    expect(ids).not.toContain("no-healthcheck");
  });
});

describe("implicit-database ORMs (found by grading buildquick's own Django scaffold)", () => {
  it("a Django project counts as a database app even though it lists no driver", () => {
    // SQLite needs no driver package, so requirements.txt names only django.
    write("requirements.txt", "django>=5.2\ndjangorestframework>=3.16\n");
    write("manage.py", "import os\n");
    write("apps/items/models.py", "from django.db import models\n");
    write("apps/items/views.py", "from rest_framework import generics\n");
    // No migrations directory, so the migrations rule must now apply and fire.
    expect(findingIds()).toContain("no-schema-migrations");
  });

  it("and stays quiet once the project has migrations", () => {
    write("requirements.txt", "django>=5.2\n");
    write("apps/items/migrations/0001_initial.py", "from django.db import migrations\n");
    expect(findingIds()).not.toContain("no-schema-migrations");
  });

  it("drizzle-kit and umzug count as migration tools - they own the schema history for Drizzle and Sequelize", () => {
    for (const tool of ["drizzle-kit", "umzug"]) {
      write("package.json", JSON.stringify({ dependencies: { "drizzle-orm": "0.45.3" }, devDependencies: { [tool]: "1.0.0" } }));
      expect(findingIds(), tool).not.toContain("no-schema-migrations");
    }
  });

  it("a Drizzle project with no migration tool is still flagged", () => {
    write("package.json", JSON.stringify({ dependencies: { "drizzle-orm": "0.45.3" } }));
    expect(findingIds()).toContain("no-schema-migrations");
  });

  it("a project with no ORM is still not a database app", () => {
    write("requirements.txt", "requests>=2.31\nclick>=8\n");
    write("main.py", "import click\n");
    expect(findingIds()).not.toContain("no-schema-migrations");
  });
});

describe("edge cases across .NET, Go, Rust, TS/JS and Java (probe-found)", () => {
  const CS_WEB = '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>';

  it("Java code under the default com/example package is graded - 'example' is not an examples folder", () => {
    write("pom.xml", "<project><dependencies><dependency><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>");
    write("src/main/java/com/example/app/A.java", '@RestController\nclass A {\n  @GetMapping("/items") String items() { return "x"; }\n}\n');
    expect(findingIds()).toContain("no-healthcheck");
  });

  it(".NET web projects are recognised by their SDK - no Microsoft.AspNetCore package is listed", () => {
    write("Api.csproj", CS_WEB);
    write("Program.cs", 'var b = WebApplication.CreateBuilder(args);\nvar app = b.Build();\napp.MapGet("/items", () => 1);\napp.Run();\n');
    expect(findingIds()).toContain("no-healthcheck");
  });

  it("SQL Server / Npgsql / Dapper count as a database, and a query per row is flagged", () => {
    write(
      "Api.csproj",
      '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Dapper" /><PackageReference Include="Microsoft.Data.SqlClient" /></ItemGroup></Project>'
    );
    write("migrations/1.sql", "select 1");
    write("R.cs", 'foreach (var id in ids)\n{\n    var o = conn.QueryFirst<Order>("SELECT Id FROM Orders WHERE Id=@id", new { id });\n}\n');
    expect(findingIds()).toContain("query-in-loop");
  });

  it("'pg' inside another word (upgrade-helper) doesn't make a project a database app", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4", "upgrade-helper": "^1" } }));
    write("a.js", "app.get('/x', h);\nconst p = new Client();\n");
    expect(runCheck(scanRepo(tmpDir)).skipped).toContain("no-connection-pool-config");
  });

  it("an entity-framework query per row via an *Async call is flagged; synchronous tracking calls aren't", () => {
    write("Api.csproj", '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Microsoft.EntityFrameworkCore" /></ItemGroup></Project>');
    write("migrations/1.sql", "x");
    write("R.cs", "foreach (var id in ids)\n{\n    var u = await _context.Users.FirstOrDefaultAsync(x => x.Id == id);\n}\n");
    expect(findingIds()).toContain("query-in-loop");
  });

  it("Go's `for _, x := range` and Rust's `for x in` are loops", () => {
    write("go.mod", "module x\nrequire github.com/lib/pq v1.0.0\n");
    write("migrations/1.sql", "x");
    write("a.go", 'for _, id := range ids {\n\trow := db.QueryRow("SELECT name FROM users WHERE id=$1", id)\n}\n');
    expect(findingIds()).toContain("query-in-loop");

    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    write("Cargo.toml", '[dependencies]\nsqlx = "0.7"\n');
    write("migrations/1.sql", "x");
    write("a.rs", 'for id in ids {\n    let row = sqlx::query("SELECT name FROM users WHERE id = $1").bind(id).fetch_one(&pool).await?;\n}\n');
    expect(findingIds()).toContain("query-in-loop");
  });

  it("Go's empty http.Client{}, Rust's reqwest::get and java.net.http clients have no timeout - a configured one is fine", () => {
    write("go.mod", "module x\n");
    write("a.go", 'client := &http.Client{}\nresp, err := client.Get("https://api.example.com")\n');
    expect(findingIds()).toContain("http-without-timeout");
    write("a.go", 'client := &http.Client{Timeout: 5 * time.Second}\nresp, err := client.Get("https://api.example.com")\n');
    expect(findingIds()).not.toContain("http-without-timeout");

    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    write("Cargo.toml", '[dependencies]\nreqwest = "0.11"\naxum = "0.7"\n');
    write("a.rs", 'let body = reqwest::get("https://api.example.com").await?.text().await?;\nlet app = Router::new();\n');
    expect(findingIds()).toContain("http-without-timeout");
    write(
      "a.rs",
      'let c = reqwest::Client::builder().timeout(Duration::from_secs(5)).build()?;\nlet body = c.get("https://api.example.com").send().await?;\nlet app = Router::new();\n'
    );
    expect(findingIds()).not.toContain("http-without-timeout");
  });

  it("Rocket (Rust) and Spring/Quarkus-style services are recognised as HTTP services", () => {
    write("Cargo.toml", '[dependencies]\nrocket = "0.5"\n');
    write("a.rs", '#[get("/items")]\nfn items() -> &\'static str { "x" }\n#[launch]\nfn rocket() -> _ { rocket::build() }\n');
    expect(findingIds()).toContain("no-healthcheck");
  });

  it("NestJS @Controller('health') - a path with no leading slash - is a health endpoint", () => {
    write("package.json", JSON.stringify({ dependencies: { "@nestjs/core": "10" } }));
    write("a.ts", "@Controller('health')\nexport class H { @Get() ok() { return 'ok'; } }\nNestFactory.create(AppModule);\n");
    expect(findingIds()).not.toContain("no-healthcheck");
  });

  it("JDBC ?password= and .NET Password= connection strings are hardcoded credentials - placeholders aren't", () => {
    write("A.java", 'String url = "jdbc:postgresql://db:5432/app?user=app&password=Sup3rSecret99";\n');
    expect(findingIds()).toContain("hardcoded-db-credentials");
    write("A.java", 'String url = "jdbc:postgresql://db:5432/app?user=app&password=${DB_PASSWORD}";\n');
    expect(findingIds()).not.toContain("hardcoded-db-credentials");

    write("appsettings.json", '{"ConnectionStrings":{"Default":"Server=db;Database=x;User Id=sa;Password=RealPass99x;"}}');
    expect(findingIds()).toContain("hardcoded-db-credentials");
    write("appsettings.json", "{}");
    write("appsettings.Development.json", '{"ConnectionStrings":{"Default":"Server=localhost;Password=RealPass99x;"}}');
    expect(findingIds()).not.toContain("hardcoded-db-credentials"); // throwaway local config
  });

  it("credential false positives found running the new patterns on real repos", () => {
    // Ordinary code assigning a property named Password is not a connection string.
    write("Map.cs", "dest.Password = src.Password.Trim();\n");
    expect(findingIds()).not.toContain("hardcoded-db-credentials");
    // A local dev database and stock default passwords aren't secrets.
    write("appsettings.json", '{"ConnectionStrings":{"Default":"Host=localhost;Port=5432;Database=x;Username=u;Password=Zk3x9qLmPw"}}');
    expect(findingIds()).not.toContain("hardcoded-db-credentials");
    write("appsettings.json", '{"ConnectionStrings":{"Default":"Host=db;Database=x;Username=postgres;Password=postgres"}}');
    expect(findingIds()).not.toContain("hardcoded-db-credentials");
    // Help text showing the shape of a string.
    write("Help.cs", 'var h = "export CONN=\\"Host=...;Database=...;Password=...\\"";\n');
    expect(findingIds()).not.toContain("hardcoded-db-credentials");
    // ...while a remote host with a real-looking password still is one, even commented out.
    write(
      "appsettings.json",
      '{"ConnectionStrings":{"Default":"Host=pg-1.b.aivencloud.com;Port=20617;Database=x;Username=u;Password=AVNS_realLookingSecret"}}'
    );
    expect(findingIds()).toContain("hardcoded-db-credentials");
  });

  it("a Python comprehension is not a loop around the query on the next line", () => {
    write("requirements.txt", "sqlalchemy\nfastapi\n");
    write("migrations/1.sql", "x");
    write("a.py", "by_cat = {c: n for c, n in rows}\ntopics = (await db.execute(select(Topic)))\n");
    expect(findingIds()).not.toContain("query-in-loop");
    write("a.py", "for doc in docs:\n    user = session.query(User).filter_by(id=doc.user_id).first()\n");
    expect(findingIds()).toContain("query-in-loop");
  });

  it("a loop's body ends where the indentation does - a query after it isn't 'in the loop'", () => {
    write("requirements.txt", "sqlalchemy\nfastapi\n");
    write("migrations/1.sql", "x");
    write("a.py", "for i, q in enumerate(items):\n    check(q)\n    if not q:\n        raise ValueError(i)\n\nmax_order = db.query(func.max(Q.n)).scalar()\n");
    expect(findingIds()).not.toContain("query-in-loop");
  });

  it("a multi-line comprehension's 'for ... in' continuation line is not a loop statement", () => {
    write("requirements.txt", "sqlalchemy\nfastapi\n");
    write("migrations/1.sql", "x");
    write("a.py", "by_topic = [\n    Out(term=term)\n    for topic_id, term in topic_rows\n]\nrows = (await db.execute(select(Outlet)))\n");
    expect(findingIds()).not.toContain("query-in-loop");
  });

  it("a seeder's one-off table read isn't an unbounded list endpoint", () => {
    write("Api.csproj", '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Microsoft.EntityFrameworkCore" /></ItemGroup></Project>');
    write("migrations/1.sql", "x");
    write("Extensions/DatabaseSeeder.cs", "var types = await dbContext.ActivityGroupTypes.ToListAsync();\n");
    expect(findingIds()).not.toContain("unbounded-list-query");
    write("Controllers/ProductController.cs", "public async Task<IActionResult> Index() => View(await _db.Products.ToListAsync());\n");
    expect(findingIds()).toContain("unbounded-list-query");
  });

  it("generic type arguments and function-typed parameters don't distort the constructor count", () => {
    write("S.cs", "public class S\n{\n    public S(IDictionary<string, decimal> a, ILogger<S> b, Func<int, string> c, IRepo d) { }\n}\n");
    expect(findingIds()).not.toContain("too-many-dependencies");
    write("S.cs", "public class OrderService(IA a, IB b, IC c, ID d, IE e, IF f, IG g, IH h)\n{\n}\n");
    expect(findingIds()).toContain("too-many-dependencies"); // C# 12 primary constructor
  });

  it(".NET test projects (App.Tests/) are tests even for files not named *Tests.cs", () => {
    write("Api.csproj", '<Project Sdk="Microsoft.NET.Sdk"/>');
    write("App.Tests/Helpers/Builder.cs", "x();\n".repeat(700));
    expect(findingIds()).not.toContain("god-file");
  });

  it("Prisma findMany() with no arguments is unbounded; with take it isn't", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4", prisma: "^5" } }));
    write("migrations/1.sql", "x");
    write("a.ts", "const all = await prisma.user.findMany();\napp.get('/u', h);\n");
    expect(findingIds()).toContain("unbounded-list-query");
    write("a.ts", "const all = await prisma.user.findMany({ take: 50 });\napp.get('/u', h);\n");
    expect(findingIds()).not.toContain("unbounded-list-query");
  });
});

describe("found measuring precision on 24 unseen repos", () => {
  it("a frontend in a monorepo subfolder is client code, even with a backend at the root", () => {
    write("Api/Api.csproj", '<Project><ItemGroup><PackageReference Include="Microsoft.AspNetCore.OpenApi" /></ItemGroup></Project>');
    write("Frontend/package.json", JSON.stringify({ dependencies: { react: "^18", axios: "^1" } }));
    write("Frontend/src/api/index.ts", 'export const get = () => fetch("https://api.example.com/items");\n');
    expect(findingIds()).not.toContain("http-without-timeout");
  });

  it("a relative-URL fetch is page code - only a browser can fetch one", () => {
    write("package.json", JSON.stringify({ dependencies: { chalk: "^5" } }));
    write("admin/admin.js", 'fetch("/js/data/insights.json").then((r) => r.json());\n');
    expect(findingIds()).not.toContain("http-without-timeout");
  });

  it("server code inside a Next.js app (Node built-ins, secrets) is still server code", () => {
    write("package.json", JSON.stringify({ dependencies: { next: "^14", react: "^18" } }));
    write(
      "src/lib/paystack.ts",
      'import crypto from "crypto";\nexport const call = () => fetch("https://api.paystack.co/x", { headers: { Authorization: process.env.PAYSTACK_SECRET_KEY } });\n'
    );
    expect(findingIds()).toContain("http-without-timeout");
  });

  it(".NET's HttpClient isn't flagged: it has a 100-second default timeout", () => {
    write("Svc.cs", "public class Svc { private readonly HttpClient _c = new HttpClient(); }\n");
    expect(findingIds()).not.toContain("http-without-timeout");
  });

  it("Alembic and Django migrations are generated code", () => {
    write("alembic/versions/115909_initial.py", '"""initial\n\nRevision ID: 115909\n"""\n' + "op.x()\n".repeat(700));
    write("app/migrations/0001_initial.py", "x = 1\n".repeat(700));
    expect(findingIds()).not.toContain("god-file");
  });

  it("a MongoDB-only app isn't told to add pooling or a SQL migration tool", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4", mongoose: "^8" } }));
    write("index.js", "const client = new MongoClient(uri);\n");
    const report = runCheck(scanRepo(tmpDir));
    expect(report.skipped).toEqual(expect.arrayContaining(["no-schema-migrations", "no-connection-pool-config"]));
  });

  it("a DTO record's constructor isn't dependency injection", () => {
    write(
      "Models/Dtos/BudgetResponse.cs",
      "public record BudgetResponse\n{\n    public BudgetResponse(string id, DateTime d, decimal a, Dictionary<string, decimal> m, decimal t, string v, int x) { }\n}\n"
    );
    expect(findingIds()).not.toContain("too-many-dependencies");
  });

  it("EF Core's synchronous Update in a loop isn't a round trip - an awaited *Async call is", () => {
    write("Api.csproj", '<Project><ItemGroup><PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL" /></ItemGroup></Project>');
    write("migrations/001.sql", "CREATE TABLE a (id int);");
    write("AddressService.cs", "foreach (var addr in defaults)\n{\n    _addressRepo.Update(addr);\n}\n");
    expect(findingIds()).not.toContain("query-in-loop");

    write("AddressService.cs", "foreach (var addr in stale)\n{\n    await _addressRepo.DeleteAsync(addr);\n}\n");
    expect(findingIds()).toContain("query-in-loop");
  });

  it("#[cfg(test)] on a single Rust item doesn't turn the rest of the file into tests", () => {
    write("Cargo.toml", '[dependencies]\ntokio = "1"\n');
    write("src/main.rs", '#[cfg(test)]\nuse std::fmt;\n\nfn main() {\n    let url = "postgres://app:realsecret99@db:5432/prod";\n}\n');
    expect(findingIds()).toContain("hardcoded-db-credentials");
  });

  it("a Create React App frontend reading REACT_APP_ env vars is still client code", () => {
    write("package.json", JSON.stringify({ dependencies: { react: "^18", "react-scripts": "5" } }));
    write("src/api.js", "export const load = () => fetch(`${process.env.REACT_APP_API_URL}/items`);\n");
    expect(findingIds()).not.toContain("http-without-timeout");
  });

  it("a service file that also declares a small record is still graded as a service", () => {
    write(
      "OrderService.cs",
      "public record OrderLine(string Sku, int Qty);\npublic class OrderService\n{\n    public OrderService(IRepo a, IMailer b, IPdf c, IPay d, ITax e, IAudit f, IFlags g) { }\n}\n"
    );
    expect(findingIds()).toContain("too-many-dependencies");
  });

  it("a record's own constructor stays quiet wherever the file lives", () => {
    write("Budget.cs", "public record BudgetResponse\n{\n    public BudgetResponse(string a, int b, int c, int d, int e, int f, int g) { }\n}\n");
    expect(findingIds()).not.toContain("too-many-dependencies");
  });

  it("Dapper's generic QueryFirst<T>() in a loop is a real per-row query", () => {
    write("Api.csproj", '<Project><ItemGroup><PackageReference Include="Dapper" /><PackageReference Include="Npgsql" /></ItemGroup></Project>');
    write("migrations/001.sql", "CREATE TABLE a (id int);");
    write("Report.cs", 'foreach (var id in ids)\n{\n    var o = conn.QueryFirst<Order>("SELECT * FROM orders WHERE id = @id LIMIT 1", new { id });\n}\n');
    const ids = findingIds();
    expect(ids).toContain("query-in-loop");
    expect(ids).not.toContain("no-connection-pool-config"); // Npgsql pools by default
  });

  it("hyphenated and underscored test folders (test-fixtures/, test_data/) are tests", () => {
    write("package.json", JSON.stringify({ dependencies: { express: "^4", pg: "^8" } }));
    write("test-fixtures/bad-app/src/app.js", 'const u = "postgres://app:realsecret99@db/x";\n');
    write("test_data/seed.js", 'const u = "postgres://app:realsecret99@db/x";\n');
    expect(findingIds()).not.toContain("hardcoded-db-credentials");
  });

  it("Go's database/sql pools by default - sql.Open returns a pool", () => {
    write("go.mod", "module x\nrequire github.com/lib/pq v1.10.0\n");
    write("migrations/001.sql", "CREATE TABLE a (id int);");
    write("db.go", 'db, err := sql.Open("postgres", dsn)\n');
    expect(findingIds()).not.toContain("no-connection-pool-config");
  });

  it("a script that calls an API isn't told to add a circuit breaker - that's a service concern", () => {
    write("requirements.txt", "requests\n");
    write("fetch_status.py", 'r = requests.get("https://api.example.com", timeout=5)\n');
    expect(runCheck(scanRepo(tmpDir)).skipped).toContain("no-circuit-breaker");
  });
});
