import { isOneOffLoader } from "./fileKinds.js";
import { codeFiles, dependsOnAny, firstMatch, firstTextMatch, lineMatchesCode } from "./repo.js";
import type { RepoSnapshot, RuleDefinition } from "./types.js";

/**
 * Database rules: query shape, pooling, schema history. Split out of
 * operationalRules.ts when it passed this project's 400-line limit - they're all
 * "operational" (the runner tags them so in rules.ts), just grouped by what they
 * inspect.
 */

const RAW_DB_CLIENT = /\bnew (Client|MongoClient)\s*\(|createConnection\s*\(|DriverManager\.getConnection/;

// SQL DDL is commonly split across lines ("CREATE VIEW x AS\n  SELECT * FROM
// t;"), so a same-line-only exclusion still false-positives on schema, not just
// the single-line case caught while auditing the first false positive. Looks
// back a few lines for the CREATE VIEW/TABLE/INDEX opener before accepting a
// SELECT * as a real, unbounded runtime query.
function firstUnboundedSelectStar(repo: RepoSnapshot) {
  const selectStar = /SELECT\s+\*\s+FROM\s+\w+\s*(?:;|["'`])/i;
  const ddlOpener = /\bCREATE\s+(VIEW|TABLE|INDEX)\b/i;

  for (const file of codeFiles(repo)) {
    const lines = file.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!selectStar.test(lines[i])) continue;
      const windowStart = Math.max(0, i - 3);
      if (lines.slice(windowStart, i + 1).some((l) => ddlOpener.test(l))) continue;
      return `${file.relPath}:${i + 1}  ${lines[i].trim().slice(0, 100)}`;
    }
  }
  return undefined;
}

/**
 * SQL built by pasting a variable into the query text, rather than passed as a parameter.
 *
 * SQL is text, not code, so this reads the raw line (see the matcher note in the maintainer notes:
 * code-only matching strips string contents, which is where every query lives). That
 * makes a narrow test essential, so a line must do all four:
 *   - call something that executes a query (.query/.execute/raw/$queryRaw);
 *   - contain a statement keyword AND a WHERE/VALUES/SET clause;
 *   - interpolate a value into that text;
 *   - carry no parameter marker, since $1/?/:name means the query is parameterised and the
 *     interpolated part is almost always a table name rather than the dangerous bit.
 * Requiring the query call is what keeps prose out ("Run SELECT ... in psql" is a string,
 * not a call), and tests and one-off loaders are skipped as elsewhere.
 */
function firstConcatenatedSql(repo: RepoSnapshot) {
  // Every ecosystem's way of saying "run this SQL". Case-insensitive and tolerant of a
  // suffix (executeQuery, QueryRow, ExecuteSqlRaw), because a verb list that only knew the
  // JavaScript spelling would quietly check one language out of eight.
  const executesQuery = /\.(query|execute|exec|raw|prepare|fetch_all|fetch_one)\w*\s*\(|\$queryRaw|\b(cursor\.execute|sqlx::query|FromSqlRaw|ExecuteSqlRaw)\b/i;
  const interpolation = /\$\{[^}]+\}|["'`]\s*\+\s*\w|\+\s*\w+\s*\+|%s\b|\{\w+\}/;
  const sqlStatement = /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i;
  const whereOrValues = /\b(WHERE|VALUES|SET)\b/i;
  const placeholder = /\$\d|\?\s*[,)]|:\w+\s*[,)"'`]/;
  // The values are passed separately even though the marker is not on this line: the query
  // text is assembled from a pre-built clause and the arguments ride alongside it. Go's
  // `args...` spread is the common shape (found in ai-cost-guard, where `SELECT COUNT(*)
  // FROM requests` + where is parameterised - the bare identifier `where` had also been
  // read as the SQL keyword).
  const passesArgsSeparately = /\w+\.\.\.|,\s*(args|params|parameters|values|bindings)\b/i;
  const commentLine = /^\s*(\/\/|#|\*|--)/;

  for (const file of codeFiles(repo)) {
    if (isOneOffLoader(file.relPath)) continue;
    const lines = file.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (commentLine.test(line)) continue;
      if (!executesQuery.test(line)) continue;
      if (!sqlStatement.test(line) || !whereOrValues.test(line)) continue;
      if (!interpolation.test(line) || placeholder.test(line)) continue;
      if (passesArgsSeparately.test(line)) continue;
      return `${file.relPath}:${i + 1}  ${line.trim().slice(0, 100)}`;
    }
  }
  return undefined;
}

export const DATABASE_RULES: RuleDefinition[] = [
  {
    id: "unbounded-list-query",
    conceptId: "pagination",
    severity: "medium",
    passSummary: "No obviously unbounded list queries",
    nextStep:
      "Add a LIMIT/cursor to the query flagged below and a default page size in the handler - don't wait for the table to grow to find out where the response times out.",
    appliesTo: (repo) => repo.hasDatabase,
    detect: (full) => {
      // One-off data loaders - seeders, migrations, backfills, fixtures - read small
      // lookup tables once at startup; they aren't list endpoints that grow with
      // traffic. (Mzuri's DatabaseSeeder was the real case.) The rest of the rule
      // sees the repo without them.
      const repo = { ...full, files: full.files.filter((f) => !isOneOffLoader(f.relPath)) };
      const evidence =
        firstMatch(repo, /\.findAll\s*\(\s*\)|\bfindAll\s*\(\s*\)\s*;/i) ??
        // No-argument list calls that return every row: Prisma's findMany(), a
        // TypeORM repository's find(), and EF Core's ToList()/ToListAsync() straight
        // off a DbSet (nothing between the set and the call - no Where, no Take).
        firstMatch(
          repo,
          /\.findMany\s*\(\s*\)|\b\w*[rR]epo\w*\.find\s*\(\s*\)|\b\w*[cC]ontext\.\w+\.ToList(Async)?\s*\(\s*[\w.]*\s*\)|\b_?db\w*\.\w+\.ToList(Async)?\s*\(\s*[\w.]*\s*\)/
        ) ??
        firstUnboundedSelectStar(repo) ??
        firstMatch(repo, /\.find\(\s*\{\s*\}\s*\)|\.scan\(\s*\)/);
      return evidence
        ? {
            ruleId: "unbounded-list-query",
            conceptId: "pagination",
            severity: "medium",
            summary: "A query fetches every row with no limit. Fine at 200 rows, a timeout at 2 million.",
            evidence,
          }
        : undefined;
    },
  },
  {
    id: "sql-string-concatenation",
    conceptId: "injection",
    severity: "high",
    passSummary: "No SQL built by string concatenation",
    nextStep:
      "Pass the value as a parameter instead of pasting it into the query text - the driver then sends code and data separately, so the value can never be read as SQL. Where the variable part is a table or column name, a parameter cannot help: check it against an allow-list of names you wrote.",
    appliesTo: (repo) => repo.hasDatabase,
    detect: (repo) => {
      const evidence = firstConcatenatedSql(repo);
      if (!evidence) return undefined;
      return {
        ruleId: "sql-string-concatenation",
        conceptId: "injection",
        severity: "high",
        summary: "A SQL statement is built by pasting a value into the query text, which is how injection happens.",
        evidence,
      };
    },
  },
  {
    id: "query-in-loop",
    conceptId: "n-plus-one-queries",
    severity: "medium",
    passSummary: "No database calls inside loops",
    nextStep:
      "If the loop iterates over something that can grow large (rows, users, orders), batch it into one query (a JOIN or an IN (...) lookup) before the loop. If it's a small, bounded set (collection names, config keys, admin metadata), this is likely fine - a static check can't tell rows from a bounded list apart, only you can.",
    appliesTo: (repo) => repo.hasDatabase,
    detect: (repo) => {
      // Every stack's loop syntax. The original only knew `for (` / `foreach (` /
      // `.map(`, so Go's `for _, x := range`, and Rust's / Python's `for x in y`
      // were never treated as loops and query-in-loop never fired for them.
      const loopStart =
        // The new forms must START the statement: `^\s*for x in y`. Unanchored, a
        // Python comprehension (`{k: v for k, v in rows}`) on the line above a query
        // looked like a loop whose body is the next few lines - two false findings
        // on real repos (impact.pulse, education).
        // ...AND end in `:` or `{` (optionally a trailing comment) - a real for
        // STATEMENT opens a block. A multi-line comprehension's continuation line
        // (`for t, n in rows` with no colon) starts with `for` too, and was read as one.
        /\b(for|foreach|while)\s*[(:]|\.forEach\s*\(|\.map\s*\(|^\s*(async\s+)?for\s+[\w,\s_&*]*:=\s*range\b(?=.*\{\s*(?:\/\/.*)?$)|^\s*for\s+range\b(?=.*\{\s*(?:\/\/.*)?$)|^\s*(async\s+)?for\s+[\w(),\s&*_]+\s+in\s(?=.*[:{]\s*(?:(?:\/\/|#).*)?$)|^\s*while\s+let\b|\.each\s+do\b|\.each\s*\{/i;
      // A DB call needs a DB-shaped receiver. The old pattern accepted any bare
      // `get(` / `fetch(` / `select(`, so `old_by_id.get(...)` - a HashMap lookup
      // in Idari - was reported as a query in a loop.
      const dbCall =
        /\b(repository|repo|db|dao|prisma|session|entityManager|em|knex|pool|conn|connection|cursor|tx|\w+Repository|\w+Repo|\w+Dao)\s*\.\s*(find|query|select|get|exec|execute|fetch|save|insert|update|delete|create|count|raw|first|all|collection|table|from|aggregate|model|prepare|scan|put)\w*\s*(<[^>()]*>)?\s*\(|\bfind(One|By\w+|All)\s*\(|\.query\s*\(|\bsqlx::query\w*\s*[(!]|\.fetch_(one|all|optional)\s*\(|\b\w*[jJ]dbcTemplate\s*\.\s*\w+\s*\(|\b\w+Mapper\s*\.\s*(select|find|get|insert|update|delete)\w*\s*\(|\.objects\.(get|filter|first|count|all|create)\s*\(|\b(FirstOrDefault|SingleOrDefault|First|Single|Find|ToList|Count|Any)Async\s*\(/i;
      // The optional <...> is a generic type argument - Dapper's conn.QueryFirst<Order>(...)
      // and EF's db.Set<User>() put one between the method name and the call.

      // A new function starts a new scope - a DB call there is not in the loop
      // above it. Idari: `Option::map` on one line, `conn.prepare(` in the next fn.
      const functionStart = /^\s*(pub(\([^)]*\))?\s+)?(async\s+)?(fn|func|def|function)\s|^\s*(public|private|protected)\s[^=;]*\(/;

      for (const file of codeFiles(repo)) {
        const lines = file.content.split("\n");
        // A migration or seed script looping over a small constant list (impact.pulse's
        // migrate_client_data.py) runs once, off the request path - not an N+1.
        if (isOneOffLoader(file.relPath)) continue;
        const isRust = file.relPath.endsWith(".rs");
        const isCSharp = file.relPath.endsWith(".cs");
        for (let i = 0; i < lines.length; i++) {
          if (!lineMatchesCode(file, i, loopStart)) continue;
          // In Rust, `.map(` is just as often Option/Result::map - it runs at
          // most once. Only an iterator chain is a loop.
          if (isRust && /\.map\s*\(/.test(lines[i]) && !/\b(iter|into_iter|iter_mut)\s*\(\)/.test(lines[i])) continue;
          // Same for Java/Kotlin: `optional.map(x -> ...)` runs at most once.
          // Only a stream on the line (or a plain loop keyword) is a loop.
          const isJvm = /\.(java|kt)$/.test(file.relPath);
          if (isJvm && /\.map\s*\(/.test(lines[i]) && !/\b(stream|parallelStream)\s*\(|\bStream\.|\bfor\s*\(/.test(lines[i])) continue;
          // Only look a few lines into the loop body - a match 50 lines later
          // usually isn't the same logical operation.
          const loopIndent = lines[i].length - lines[i].trimStart().length;
          for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
            if (functionStart.test(lines[j])) break;
            // The loop's body is what's indented deeper than the loop line. The first
            // non-blank line at the same indent or shallower (the closing brace, the
            // next statement) is OUTSIDE it - a query there isn't "in the loop". A
            // 3-line Python loop followed by an unrelated query was reported (education).
            // (A lone `{` is the loop's own opening brace in Allman style - C# and Java
            // put it on the next line at the SAME indent - so it doesn't end anything.)
            const trimmed = lines[j].trim();
            if (trimmed !== "" && trimmed !== "{" && lines[j].length - lines[j].trimStart().length <= loopIndent) break;
            // EF Core's synchronous Update/Add/Remove/Attach only mark tracked
            // entities; nothing reaches the database until one SaveChanges after
            // the loop. Every OTHER call still counts - Dapper's synchronous
            // conn.QueryFirst(...) is a real query per row.
            const efTrackingOnly =
              isCSharp && /\.(Update|Add|Remove|Attach|Entry|AddRange|UpdateRange|RemoveRange)\s*\(/.test(lines[j]) && !/Async\s*\(/.test(lines[j]);
            const isRoundTrip = !efTrackingOnly;
            if (isRoundTrip && lineMatchesCode(file, j, dbCall)) {
              return {
                ruleId: "query-in-loop",
                conceptId: "n-plus-one-queries",
                severity: "medium",
                summary:
                  "A database call appears inside a loop - worth confirming this doesn't turn into one query per row on a collection that can actually grow.",
                evidence: `${file.relPath}:${j + 1}  ${lines[j].trim().slice(0, 100)}`,
              };
            }
          }
        }
      }
      return undefined;
    },
  },
  {
    id: "no-connection-pool-config",
    serviceOnly: true,
    conceptId: "connection-pooling",
    severity: "low",
    passSummary: "Connection pooling is in place",
    // Most ORMs and frameworks pool by default (Spring Boot ships HikariCP, EF Core
    // and Prisma pool out of the box), so claiming "no pooling" there would be flatly
    // wrong. This only applies to raw driver usage, where a connection per request
    // is a real possibility.
    nextStep:
      "Replace ad-hoc client construction with a pooled client (pg.Pool, a configured DataSource, etc.), sized to the database's real connection limit divided by your instance count.",
    // Pooling exists to share a scarce resource: connections to a database
    // *server*. An embedded database (SQLite) is a file in the same process,
    // with no connection limit to hit - telling a local tool to pool it is noise.
    appliesTo: (repo) =>
      repo.hasDatabase &&
      dependsOnAny(repo, [
        "postgres",
        '"pg"',
        "mysql",
        "mariadb",
        "mongodb",
        "mongoose",
        "mssql",
        "sqlserver",
        "oracle",
        "npgsql",
        "psycopg",
        "pgx",
        "lib/pq",
      ]) &&
      !dependsOnAny(repo, [
        "spring-boot-starter-data-jpa",
        "hibernate",
        "entityframeworkcore",
        "entityframework",
        "prisma",
        "sequelize",
        "typeorm",
        "sqlalchemy",
        "gorm",
        "activerecord",
        "knex",
        // The official MongoDB driver (and mongoose, which wraps it) pool by
        // default - maxPoolSize 100. Books-store was told to add pooling it had.
        "mongodb",
        "mongoose",
        // ADO.NET providers pool per connection string by default (Pooling=true),
        // so raw Npgsql/Dapper code already pools.
        "npgsql",
        "microsoft.data.sqlclient",
        "system.data.sqlclient",
        "mysqlconnector",
        "mysql.data",
      ]),
    detect: (repo) => {
      // Instantiating a pool at all counts - `new Pool()` pools with sane defaults
      // even when nothing is tuned. The rule is about having no pooling, not
      // about having untuned pooling.
      const configured = repo.files.some((f) =>
        // Go's database/sql: sql.Open returns a connection pool, not a connection.
        /hikari|pool_?size|maxPoolSize|max_connections|poolMax|connection_?pool|pgbouncer|MaximumPoolSize|SetMaxOpenConns|new Pool\s*\(|createPool\s*\(|ConnectionPool|\bsql\.Open\s*\(|pgxpool\./i.test(
          f.content
        )
      );
      return configured
        ? undefined
        : {
            ruleId: "no-connection-pool-config",
            conceptId: "connection-pooling",
            severity: "low",
            summary: "No connection pool settings found - under load this hits the database's connection limit rather than queuing.",
            // Points at the raw client being constructed, when one is found - the
            // thing that should become a pool. Absent-check, so this can be undefined.
            evidence: firstMatch(repo, RAW_DB_CLIENT),
          };
    },
  },
  {
    id: "no-schema-migrations",
    conceptId: "schema-migrations",
    severity: "medium",
    passSummary: "Schema changes are managed by a migration tool",
    nextStep:
      "Adopt a migration tool (Flyway, Liquibase, Alembic, Prisma Migrate, Rails/Django migrations, golang-migrate or goose for Go, sqlx/refinery for Rust) and commit the migration files. Then use expand/contract for anything destructive: add the new column, backfill, write both and read the new one, and only drop the old column in a later release.",
    // Only meaningful for something that owns a relational schema. A MongoDB-only
    // app has no ALTER TABLE to manage, and telling Books-store to adopt Flyway
    // was wrong advice.
    appliesTo: (repo) =>
      repo.hasDatabase &&
      !(
        dependsOnAny(repo, ["mongodb", "mongoose"]) &&
        !dependsOnAny(repo, [
          "postgres",
          '"pg"',
          "mysql",
          "mariadb",
          "sqlite",
          "mssql",
          "sqlserver",
          "entityframework",
          "prisma",
          "sequelize",
          "typeorm",
          "sqlalchemy",
          "gorm",
          "diesel",
        ])
      ),
    detect: (repo) => {
      const migrationDir = /(^|\/)(migrations?|db\/migrate|alembic\/versions|prisma\/migrations|liquibase|flyway)(\/|$)/i;
      const migrationDep = [
        "flyway",
        "liquibase",
        "alembic",
        "prisma",
        "sequelize-cli",
        "knex",
        "typeorm",
        "activerecord",
        "golang-migrate",
        "atlas",
        "dbmate",
        "ardanlabs/darwin",
        "pressly/goose",
        "gormigrate",
        "refinery",
        "diesel_migrations",
        "fluentmigrator",
        "dbup",
        "drizzle-kit",
        "umzug",
      ];

      const hasDir = repo.allPaths.some((p) => migrationDir.test(p));
      if (hasDir || dependsOnAny(repo, migrationDep)) return undefined;

      // Schema created by the app itself at startup (common for SQLite tools, like
      // ai-cost-guard). "Applied by hand" would be false there - and the real
      // problem is more specific, and more teachable.
      const inCode = firstTextMatch(repo, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i);
      return {
        ruleId: "no-schema-migrations",
        conceptId: "schema-migrations",
        severity: "medium",
        summary: inCode
          ? "The schema is created in code with CREATE TABLE IF NOT EXISTS. That works until the first change: IF NOT EXISTS never alters a table that already exists, so a new column silently never reaches existing databases."
          : "A database is in use but no migration files or migration tool were found - schema changes are being applied by hand, so there's no ordered, reviewable record of how this database reached its current shape.",
        evidence: inCode,
      };
    },
  },
];
