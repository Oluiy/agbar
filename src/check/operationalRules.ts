import path from "node:path";
import {
  anyServerCodeMatches,
  anyTextMatches,
  codeFiles,
  dependsOnAny,
  firstMatch,
  firstTextMatch,
  isClientCode,
  isPathIgnored,
  isTestLine,
  isTestPath,
  lineMatchesCode,
} from "./repo.js";
import { hasHealthCheck, hasRateLimiting, servesHttp } from "./evidence.js";
import type { RuleDefinition } from "./types.js";

/**
 * Operational rules: does this service survive real traffic? Secrets, limits,
 * timeouts, outbound calls. Database rules (query shape, pooling, schema history)
 * live in databaseRules.ts; structuralRules.ts is the other half - whether a
 * person can still modify it.
 *
 * Every rule names the concept that explains it (types.ts says why that's
 * mandatory). Heuristics over source text, tuned to stay quiet rather than to
 * catch everything - a checker that cries wolf gets uninstalled.
 */

// Where the web app or the DB client gets instantiated - the natural place to
// point at for an "absence" finding (no rate limiter, no healthcheck, no pool),
// since there's no single line where a *missing* thing would be.
const APP_SETUP =
  /\bexpress\s*\(\)|Fastify\s*\(|new Koa\s*\(|WebApplication\.CreateBuilder|SpringApplication\.run|Flask\s*\(|FastAPI\s*\(|gin\.Default\s*\(|App::new\s*\(|fiber\.New\s*\(|echo\.New\s*\(|Router::new\s*\(|http\.ListenAndServe\s*\(/;

/**
 * A call that leaves this process. A fetch whose URL starts with "/" (but not
 * "//") is excluded: only a browser can fetch a relative URL - Node's fetch
 * throws on one - so `fetch("/js/data/x.json")` is page code talking to its own
 * site, found in a static admin page (fdaweb) that was being graded as a server.
 */
/**
 * Calls whose client has NO timeout unless you set one - per stack: fetch / axios
 * (JS), requests (Python), Go's http.Get and an empty http.Client{}, Rust's
 * reqwest::get / Client::new() and ureq, Java's RestTemplate and java.net.http.
 * (.NET's HttpClient is deliberately absent: it has a 100 s default.)
 * This is the ONE source both regexes below are built from, so "which calls do we
 * flag" and "which services make outbound calls" can't drift apart.
 */
/**
 * The global `fetch` exists only in JavaScript runtimes, so these patterns only count in
 * JS/TS files. Applied everywhere, a Go method *named* fetch - `func (r *Repo) fetch(ctx,
 * query)`, a SQL helper - was reported as an HTTP call with no timeout (go-clean-arch,
 * held-out batch 2).
 */
const JS_ONLY_CALLS = [
  // Not a method named fetch: sqlx's `.fetch(&pool)` and Eloquent-style `.fetch()`
  // are database calls. Only the global (or window./globalThis.) fetch is HTTP.
  String.raw`(?<![\w.])fetch\s*\(\s*(?!["'\x60]\/(?!\/))`,
  String.raw`\b(?:window|globalThis)\.fetch\s*\(\s*(?!["'\x60]\/(?!\/))`,
];
const JS_FAMILY = /\.(m?[jt]sx?|c[jt]s|vue|svelte)$/i;
const ANY_LANGUAGE_CALLS = [
  String.raw`axios\.`,
  String.raw`new RestTemplate`,
  String.raw`requests\.(get|post|put|patch|delete)\s*\(`,
  String.raw`\bhttp\.(Get|Post|Head)\s*\(`,
  String.raw`\bhttp\.Client\s*\{\s*\}`,
  String.raw`\bhttp\.DefaultClient\b`,
  String.raw`\breqwest::(blocking::)?(get|Client::new)\s*\(`,
  String.raw`\bureq::(get|post|put|delete)\s*\(`,
  String.raw`\bHttpClient\.new(HttpClient|Builder)\s*\(`,
];
const NO_DEFAULT_TIMEOUT = new RegExp([...JS_ONLY_CALLS, ...ANY_LANGUAGE_CALLS].join("|"));
const NON_JS_CALL = new RegExp(ANY_LANGUAGE_CALLS.join("|"));

/** The calls that can actually appear in this file's language. */
function httpCallFor(relPath: string): RegExp {
  return JS_FAMILY.test(relPath) ? NO_DEFAULT_TIMEOUT : NON_JS_CALL;
}
const OUTBOUND_CALL = new RegExp(`${NO_DEFAULT_TIMEOUT.source}|axios|RestTemplate|HttpClient`);

/** Index of the line where the call opened on `start` closes its parentheses (capped at 20 lines). */
function callEnd(lines: string[], start: number): number {
  let depth = 0;
  for (let j = start; j < Math.min(lines.length, start + 20); j++) {
    for (const ch of lines[j]) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
    }
    if (depth <= 0 && j >= start) return j;
  }
  return Math.min(lines.length - 1, start + 20);
}

export const OPERATIONAL_RULES: RuleDefinition[] = [
  {
    id: "env-not-ignored",
    conceptId: "secrets-management",
    severity: "high",
    passSummary: "No unignored .env file",
    nextStep:
      "Add `.env` to `.gitignore` right now, then rotate every credential that was ever in it - the fix protects what happens next, not what already leaked.",
    appliesTo: (repo) => repo.allPaths.some((p) => p === ".env" || p.endsWith("/.env")),
    detect: (repo) => {
      // Per-file, not a single repo-wide boolean: a monorepo can have several
      // .env files, each covered (or not) by a different nested .gitignore.
      const uncovered = repo.allPaths.filter((p) => p === ".env" || p.endsWith("/.env")).find((p) => !isPathIgnored(repo, p));
      return uncovered
        ? {
            ruleId: "env-not-ignored",
            conceptId: "secrets-management",
            severity: "high",
            summary: "A .env file exists but no .gitignore covers it - credentials can reach the repo's history.",
            evidence: uncovered,
          }
        : undefined;
    },
  },
  {
    id: "committed-private-key",
    conceptId: "secrets-management",
    severity: "high",
    passSummary: "No private keys or AWS access keys in source",
    nextStep:
      "Rotate the key or credential immediately at the provider, then remove it from git history (git filter-repo or BFG) - deleting the file alone leaves it recoverable in every prior commit.",
    appliesTo: () => true,
    detect: (repo) => {
      // AKIA...EXAMPLE (AWS's own documented placeholder, AKIAIOSFODNN7EXAMPLE)
      // matches AKIA[0-9A-Z]{16} exactly and is pasted into docs/tests constantly
      // as "here's what a key looks like" - a real secret scanner has to know
      // AWS's own convention that every placeholder key ends in EXAMPLE.
      const keyPattern = /-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA(?!\w*EXAMPLE)[0-9A-Z]{16}/;
      // Key material is text - it lives inside strings, so this reads raw text.
      const match = firstTextMatch(repo, keyPattern);
      // Also check non-code files - keys hide in config more often than in code.
      // Test files are excluded because fake key literals in fixtures are the
      // common case and flagging them is exactly how this tool would lose trust.
      // A real key-material file (.pem/.key/...) still counts wherever it lives.
      const configMatch = repo.files.find((f) => {
        if (!keyPattern.test(f.content)) return false;
        const isKeyFile = /\.(pem|key|p12|pfx|jks)$/i.test(f.relPath);
        return isKeyFile || !isTestPath(f.relPath);
      });
      const evidence = match ?? (configMatch ? configMatch.relPath : undefined);
      return evidence
        ? {
            ruleId: "committed-private-key",
            conceptId: "secrets-management",
            severity: "high",
            summary: "What looks like a private key or AWS access key is committed. Rotate it - removing the file doesn't remove it from history.",
            evidence,
          }
        : undefined;
    },
  },
  {
    id: "no-rate-limiting",
    serviceOnly: true,
    conceptId: "rate-limiting",
    severity: "medium",
    passSummary: "A rate limiter is wired in",
    nextStep:
      "Add a rate limiter to the framework's middleware chain (e.g. express-rate-limit, @nestjs/throttler, resilience4j) in front of the routes, not inside individual handlers - one place, applies everywhere.",
    // Only meaningful for something that serves HTTP: a web framework in the
    // manifest AND a real server or route in source, per servesHttp.
    appliesTo: servesHttp,
    detect: (repo) =>
      hasRateLimiting(repo)
        ? undefined
        : {
            ruleId: "no-rate-limiting",
            conceptId: "rate-limiting",
            severity: "medium",
            summary: "No rate limiting found on an HTTP service - one misbehaving client or a credential-stuffing bot can take it down.",
            // "Absent" has no single line to point to, so this points at where the
            // app is wired up instead - the natural place a limiter would go.
            evidence: firstMatch(repo, APP_SETUP),
          },
  },
  {
    id: "no-healthcheck",
    serviceOnly: true,
    conceptId: "observability",
    severity: "medium",
    passSummary: "A health endpoint exists",
    nextStep:
      "Add a GET /health (or /healthz) route that returns 200 once the process can actually serve traffic - checking a real dependency like the DB connection, not just that the process is running.",
    appliesTo: servesHttp,
    detect: (repo) =>
      hasHealthCheck(repo)
        ? undefined
        : {
            ruleId: "no-healthcheck",
            conceptId: "observability",
            severity: "medium",
            summary: "No health endpoint found - a load balancer or orchestrator has no way to tell a wedged instance from a healthy one.",
            evidence: firstMatch(repo, APP_SETUP),
          },
  },
  {
    id: "http-without-timeout",
    // Was "retry-mechanisms" - a concept that never mentions timeouts, so a
    // beginner following "Learn why" learned nothing about their finding.
    conceptId: "timeouts",
    severity: "medium",
    passSummary: "Outbound HTTP calls set timeouts",
    nextStep:
      "Pass an explicit timeout on the call flagged below (AbortSignal.timeout() in JS, http.Client{Timeout: ...} in Go, timeout= in Python requests) - a default of 'wait forever' is the actual bug.",
    appliesTo: (repo) => anyServerCodeMatches(repo, OUTBOUND_CALL),
    detect: (repo) => {
      // Bug found auditing the whole rule set: this used to check "does the word
      // 'timeout' appear ANYWHERE in the repo" - a k8s readinessProbe
      // timeoutSeconds, a test's own timeout, or an unrelated DB timeout would
      // silence this globally, even if the actual fetch call had none. Scoped to
      // a window around each call site instead - the same fix query-in-loop
      // already used for the opposite reason (avoiding false positives).
      // Case-sensitive on purpose: with /i, a C# repository method named
      // `Fetch(` (an EF Core query, no HTTP anywhere) was reported as an
      // outbound call. Each real API is spelled one way.
      // No `new HttpClient` here: .NET's HttpClient has a 100s default timeout, so
      // "waits forever" would be false. (Java RestTemplate, Python requests, Go's
      // http.Get and fetch really do default to no timeout.)
      const timeoutConfig = /timeout|Timeout|AbortSignal|AbortController|setConnectTimeout|setReadTimeout|deadline|WithTimeout/;

      for (const file of codeFiles(repo)) {
        // Browser code calling its own backend: no server thread pool to exhaust.
        if (isClientCode(repo, file)) continue;
        const lines = file.content.split("\n");
        const httpCall = httpCallFor(file.relPath);
        for (let i = 0; i < lines.length; i++) {
          if (!lineMatchesCode(file, i, httpCall)) continue;
          // Read to the end of the call itself. A fixed 2-line window missed
          // `timeout=90` on the 4th line of a multi-line requests.post(...),
          // though every call in that repo (impact.pulse) had a timeout.
          const windowStart = Math.max(0, i - 2);
          const windowEnd = Math.min(lines.length, callEnd(lines, i) + 2);
          // Code only: a comment saying "TODO: add a timeout" - or a suppression
          // naming this very rule, http-without-timeout - is not a timeout.
          let hasTimeout = false;
          for (let k = windowStart; k < windowEnd && !hasTimeout; k++) hasTimeout = lineMatchesCode(file, k, timeoutConfig);
          if (hasTimeout) continue;
          return {
            ruleId: "http-without-timeout",
            conceptId: "timeouts",
            severity: "medium",
            summary: "Outbound HTTP calls with no timeout found - one slow dependency can hold your threads open indefinitely.",
            evidence: `${file.relPath}:${i + 1}  ${lines[i].trim().slice(0, 100)}`,
          };
        }
      }
      return undefined;
    },
  },
  {
    id: "hardcoded-db-credentials",
    conceptId: "secrets-management",
    severity: "high",
    passSummary: "No connection strings with embedded credentials in source",
    nextStep:
      "Move the credential out to an environment variable and build the connection string from it at runtime. A URL that's easy to construct is also easy to leak, since it travels with the source instead of the environment.",
    appliesTo: () => true,
    detect: (repo) => {
      // user:password@ inside a connection URL, excluding the placeholder forms
      // people actually write in docs/tests: password/changeme/xxx/<password>
      // and friends - the same "known placeholder" problem as the AWS example key.
      // The three shapes a password takes in a connection string, each with the
      // password as capture group 2: a URL (postgres://u:PW@h - Go, Rust, Node),
      // a JDBC query parameter (...?user=u&password=PW - Java), and an ADO.NET
      // key (Server=..;Password=PW; - every .NET connection string).
      const credentialPatterns = [
        /(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[\w.-]+:([^@\s"'`]+)@/i,
        /(jdbc:[a-z0-9]+:[^"'\s]*?[?&;](?:password|pwd))=([^&;"'\s]+)/i,
        // Connection-string form only: `Password=PW` with no spaces, not preceded by a
        // `.` or word character, ending at `;` or the closing quote. Ordinary code
        // like `dest.Password = src.Password.Trim();` matched the looser pattern.
        // A backslash ends the value too: inside a C# or JSON string the closing quote
        // is written \" - help text `Password=...\"` must capture `...`, not `...\`.
        /((?<![\w.])(?:Password|Pwd))=([^;"'\s\\]+)(?=;|["'\\])/,
      ];
      // One or two characters (`u:p@h`) is a stand-in, never a real password.
      // So is anything that is obviously a template slot: ${VAR}, {{var}}, %VAR%,
      // $(VAR), #{var}, <pwd>, ******.
      // Stock default passwords count too: `postgres`, `root`, `sa`, `password123`
      // are what a dev database container ships with - nobody is protecting
      // anything with them - and `...` is help text showing the shape of a string.
      const placeholder =
        /^(password\d*|changeme|change[-_]?me|xxxx?|your.*|<[^>]*>|\{[^}]*\}|\$\{[^}]*\}|\$\([^)]*\)|%\w+%|#\{[^}]*\}|\*+|\.+|…|example|pass|pwd|secret|dummy|test|postgres|root|admin|administrator|sa|guest|mysql|mariadb|docker|dev|demo|12345\d*|p@ssw0rd|letmein|qwerty|.{1,2})$/i;

      // A connection string that points at THIS machine holds a throwaway dev
      // password (`Host=localhost;...;Password=postgres`). Flagging it as a HIGH
      // leak buries the real ones - a remote host like *.aivencloud.com - so a
      // line naming localhost, loopback, a docker alias or LocalDB is left alone.
      const localTarget = /\b(localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal)\b|\(localdb\)|(Server|Data Source|Host)=\.(?=[;,\\])/i;

      // Committed config is where .NET and Spring projects actually keep these:
      // appsettings.json, application.properties / .yml. Development and local
      // variants are meant to hold throwaway values, so they're left alone.
      const committedConfig = /(^|\/)(appsettings(\.[\w-]+)?\.json|application([-.][\w-]+)?\.(properties|ya?ml))$/i;
      const throwaway = /(development|dev|local|test|example|sample|template)/i;
      const configFiles = repo.files.filter((f) => committedConfig.test(f.relPath) && !throwaway.test(path.basename(f.relPath)) && !isTestPath(f.relPath));

      for (const file of [...codeFiles(repo), ...configFiles]) {
        const lines = file.content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (isTestLine(file, i)) break;
          if (localTarget.test(lines[i])) continue;
          // A leading backslash is the escape for a template slot written inside a JS/TS
          // template string: `\${POSTGRES_PASSWORD:-postgres}` is still the placeholder
          // ${...}, not a password. buildquick's own scaffold templates tripped this.
          const m = credentialPatterns.map((re) => re.exec(lines[i])).find((hit) => hit !== null && !placeholder.test(hit[2].replace(/^\\+/, "")));
          if (m) {
            return {
              ruleId: "hardcoded-db-credentials",
              conceptId: "secrets-management",
              severity: "high",
              summary: "A database connection string with an embedded credential is committed to source.",
              evidence: `${file.relPath}:${i + 1}`,
            };
          }
        }
      }
      return undefined;
    },
  },
  {
    id: "no-circuit-breaker",
    serviceOnly: true,
    conceptId: "circuit-breakers",
    severity: "low",
    passSummary: "A circuit breaker guards outbound calls",
    nextStep:
      "Wrap the outbound call in a circuit breaker (opossum, resilience4j-circuitbreaker, Polly, pybreaker, gobreaker) so a failing dependency gets skipped for a cooldown instead of every request queuing up behind it.",
    // Same population as http-without-timeout - a service that makes outbound
    // calls at all. Low severity: a timeout already bounds the damage per call;
    // a breaker is the next layer up, not the first thing to reach for.
    // A breaker protects a *service* from a failing dependency taking its request
    // capacity down with it. A script or CLI that calls an API has no requests to
    // protect - flagging those (writing_rust, a one-off Python script) was noise.
    appliesTo: (repo) => servesHttp(repo) && anyServerCodeMatches(repo, OUTBOUND_CALL),
    detect: (repo) =>
      dependsOnAny(repo, ["opossum", "resilience4j-circuitbreaker", "polly", "pybreaker", "gobreaker", "hystrix"]) || anyTextMatches(repo, /circuit\s*breaker/i)
        ? undefined
        : {
            ruleId: "no-circuit-breaker",
            conceptId: "circuit-breakers",
            severity: "low",
            summary:
              "No circuit breaker found around outbound calls - a failing dependency gets retried by every request instead of being skipped for a cooldown.",
          },
  },
  {
    id: "in-memory-session-store",
    serviceOnly: true,
    conceptId: "statelessness",
    severity: "medium",
    passSummary: "Sessions aren't kept in a single process's memory",
    nextStep:
      "Point express-session at an external store (connect-redis, connect-pg-simple, connect-mongo) instead of its default MemoryStore, so any instance can serve any request and a restart doesn't log everyone out.",
    appliesTo: (repo) => dependsOnAny(repo, ["express-session"]),
    detect: (repo) =>
      dependsOnAny(repo, ["connect-redis", "connect-mongo", "connect-pg-simple", "express-mysql-session", "connect-dynamodb"])
        ? undefined
        : {
            ruleId: "in-memory-session-store",
            conceptId: "statelessness",
            severity: "medium",
            summary:
              "express-session is used with no external store configured - sessions live in one process's memory, so a restart or a second instance loses them.",
          },
  },
];
