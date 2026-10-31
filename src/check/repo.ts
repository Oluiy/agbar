import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ignore from "ignore";
import { dependencyText, frontendRoots } from "./manifests.js";
import { PROJECT_KINDS, type ProjectKind, type RepoSnapshot, type SourceFile } from "./types.js";

// repo.ts builds the snapshot; what a file IS lives in fileKinds.ts and how rules
// SEARCH lives in matchers.ts. Re-exported so rule files keep one import site.
export { codeFiles, isBrowserPath, isClientCode, isGeneratedFile, isTestLine, isTestPath } from "./fileKinds.js";
export {
  anyCodeMatches,
  anyServerCodeMatches,
  anyTextMatches,
  codeLines,
  dependsOnAny,
  fileLineCounts,
  firstMatch,
  firstTextMatch,
  lineMatchesCode,
} from "./matchers.js";

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "target",
  "bin",
  "obj",
  "vendor",
  "venv",
  ".venv",
  "__pycache__",
  ".next",
  ".nuxt",
  "coverage",
  ".gradle",
  ".idea",
  ".vscode",
]);

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".java",
  ".kt",
  ".cs",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".php",
  ".yml",
  ".yaml",
  ".json",
  ".xml",
  ".toml",
  ".properties",
  ".env",
  ".sql",
]);

// Read so the private-key rule can see key material. Matching on content
// ("BEGIN ... PRIVATE KEY") is what separates an actual private key from a
// public certificate, which is also commonly a .pem.
const SECRET_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx", ".jks"]);

const MANIFEST_FILES = [
  "package.json",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "requirements.txt",
  "pyproject.toml",
  "Gemfile",
  "go.mod",
  "Cargo.toml",
  "composer.json",
  // .NET central package management: versions (and sometimes the packages) live here.
  "Directory.Packages.props",
];

// Bounded so `check` stays fast on a large monorepo instead of reading everything.
const MAX_FILES = 2000;
const MAX_FILE_BYTES = 512 * 1024;

/**
 * Anything that means "this project talks to a database", per stack. Matched as
 * whole tokens, not substrings: `pg` used to match inside "upgrade-helper", and
 * making that project look like a database app pulled in every database rule.
 * Missing signals were the opposite failure - SQL Server (Microsoft.Data.SqlClient),
 * Npgsql/Dapper, sqlx, pgx and plain JDBC projects were treated as having no
 * database, so all their query rules silently never ran.
 */
const DATABASE_SIGNALS = new RegExp(
  "(?<![a-z0-9])(" +
    [
      "pg",
      "pgx",
      "pq",
      "postgres",
      "postgresql",
      "npgsql",
      "psycopg2?",
      "asyncpg",
      "mysql",
      "mysql2",
      "mysqlconnector",
      "mariadb",
      "mssql",
      "sqlserver",
      "sqlclient",
      "oracledb",
      "ojdbc\\d*",
      "jdbc",
      "sqlite3?",
      "rusqlite",
      "better-sqlite3",
      "mongodb",
      "mongoose",
      "redis-om",
      "sqlx",
      "diesel",
      "sea-orm",
      "tokio-postgres",
      "r2d2",
      "deadpool-postgres",
      "gorm",
      "sqlalchemy",
      "prisma",
      "sequelize",
      "typeorm",
      "knex",
      "drizzle-orm",
      "dapper",
      "entityframework\\w*",
      "hibernate",
      "spring-boot-starter-data-\\w+",
      "mybatis",
      "jooq",
      "go-sql-driver",
      "activerecord",
      // ORMs whose database is implicit: a Django project on SQLite lists no driver at
      // all (sqlite3 is in Python's stdlib), so without these every database rule was
      // silently skipped - found by grading agbar's own generated Django output.
      "django",
      "peewee",
      "tortoise-orm",
      "sqlmodel",
    ].join("|") +
    ")(?![a-z0-9])"
);

function walk(dir: string, root: string, files: string[]): void {
  if (files.length >= MAX_FILES) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // unreadable directory - skip rather than fail the whole run
  }

  for (const entry of entries) {
    if (files.length >= MAX_FILES) return;
    if (IGNORED_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      walk(full, root, files);
    } else {
      files.push(path.relative(root, full).split(path.sep).join("/"));
    }
  }
}

export function scanRepo(root: string): RepoSnapshot {
  if (!existsSync(root)) throw new Error(`No such directory: ${root}`);

  const allPaths: string[] = [];
  walk(root, root, allPaths);

  const files: SourceFile[] = [];
  for (const relPath of allPaths) {
    const ext = path.extname(relPath).toLowerCase();
    const base = path.basename(relPath);
    // .csproj must be read here: the manifest filter below always accepted it, but
    // this line skipped it first, so no .NET dependency was ever seen - ASP.NET,
    // EF Core and Npgsql were invisible and every .NET repo was half-checked.
    if (!SOURCE_EXTENSIONS.has(ext) && !SECRET_EXTENSIONS.has(ext) && !MANIFEST_FILES.includes(base) && ext !== ".csproj" && base !== ".env") continue;
    const full = path.join(root, relPath);
    try {
      if (statSync(full).size > MAX_FILE_BYTES) continue;
      files.push({ relPath, content: readFileSync(full, "utf-8") });
    } catch {
      continue; // binary or unreadable - not worth failing over
    }
  }

  const gitignorePath = path.join(root, ".gitignore");
  const gitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf-8") : "";

  // Every .gitignore in the repo, not just the root one - a monorepo's
  // apps/api/.gitignore covers apps/api/.env even when the root has none.
  const gitignores: Record<string, string> = {};
  for (const relPath of allPaths) {
    if (path.basename(relPath) !== ".gitignore") continue;
    try {
      gitignores[relPath] = readFileSync(path.join(root, relPath), "utf-8");
    } catch {
      continue;
    }
  }

  const manifests = files
    .filter((f) => MANIFEST_FILES.includes(path.basename(f.relPath)) || f.relPath.endsWith(".csproj"))
    .map(dependencyText)
    .join("\n")
    .toLowerCase();

  return {
    root,
    files,
    allPaths,
    gitignore,
    gitignores,
    manifests,
    hasDatabase: DATABASE_SIGNALS.test(manifests),
    kind: readProjectKind(root),
    frontendRoots: frontendRoots(files),
  };
}

/**
 * `{"kind": "cli"}` in the checked repo's `.agbarrc` (the same JSON file
 * `learn` reads contentDir from). Fails loudly on a typo'd kind, like the rest of
 * the config: silently ignoring `"kind": "clii"` would run every rule anyway and
 * leave the user wondering why the setting does nothing.
 */
function readProjectKind(root: string): ProjectKind | undefined {
  const rcPath = path.join(root, ".agbarrc");
  if (!existsSync(rcPath)) return undefined;
  let kind: unknown;
  try {
    kind = (JSON.parse(readFileSync(rcPath, "utf-8")) as { kind?: unknown }).kind;
  } catch {
    throw new Error(`${rcPath}: not valid JSON.`);
  }
  if (kind === undefined) return undefined;
  if (!PROJECT_KINDS.includes(kind as ProjectKind)) {
    throw new Error(`${rcPath}: "kind" must be one of ${PROJECT_KINDS.join(", ")} - got ${JSON.stringify(kind)}.`);
  }
  return kind as ProjectKind;
}

/**
 * True when `targetRelPath` is covered by ANY .gitignore between its own
 * directory and the repo root - not just the root .gitignore. Real gitignore
 * semantics (negation, comments, `**` globs) via the `ignore` package rather
 * than hand-rolled line matching, since those semantics are easy to get subtly
 * wrong. Each candidate .gitignore is checked independently with the target
 * path rebased relative to that .gitignore's own directory - correct for the
 * common case (a .gitignore covering a file in its own directory or below),
 * without needing to replicate git's full multi-level precedence rules.
 */
export function isPathIgnored(repo: RepoSnapshot, targetRelPath: string): boolean {
  const targetDir = path.dirname(targetRelPath);
  const dirParts = targetDir === "." ? [] : targetDir.split("/");

  for (let i = dirParts.length; i >= 0; i--) {
    const gitignoreDir = dirParts.slice(0, i).join("/");
    const gitignoreRelPath = gitignoreDir ? `${gitignoreDir}/.gitignore` : ".gitignore";
    const content = repo.gitignores[gitignoreRelPath];
    if (content === undefined) continue;

    const pathFromGitignore = gitignoreDir ? path.relative(gitignoreDir, targetRelPath) : targetRelPath;
    if (ignore().add(content).ignores(pathFromGitignore)) return true;
  }
  return false;
}
