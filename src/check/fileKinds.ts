import path from "node:path";
import { isFrameworkServerFile } from "./manifests.js";
import type { RepoSnapshot, SourceFile } from "./types.js";

/**
 * What kind of file is this? Test, generated, vendored, client-side - or code a
 * person wrote and should be graded on. Every rule relies on these answers, and
 * nearly every false positive found on real repos was one of them being wrong.
 */

/**
 * Test code legitimately does things production code shouldn't - unbounded
 * fetches, hardcoded credentials, fake key material - so grading it produces
 * noise, not signal.
 */
export function isTestPath(relPath: string): boolean {
  const lower = relPath.toLowerCase();
  return (
    // Hyphenated/underscored forms too (test-fixtures/, test_data/, __fixtures__/):
    // aggregator's own deliberately-bad fixture repos were graded as its code.
    /(^|\/)(tests?|spec|__tests__|__mocks__|__fixtures__|fixtures?|testdata|test[-_]?fixtures?|test[-_]data|e2e|cypress|playwright|examples|benches|benchmarks?)\//.test(
      lower
    ) ||
    // NOT the singular "example": `com/example/` is the default Java package from
    // Spring Initializr and most tutorials. The plural `examples/` is Rust's and Go's
    // convention for runnable samples, and is the only one that means a folder of them.
    // .NET test projects live in a folder named after the project: `App.Tests/`,
    // `App.UnitTests/`, `App.IntegrationTests/` - and most files inside them don't
    // end in "Tests.cs" (builders, fixtures, helpers), so the filename rules missed them.
    /(^|\/)[\w.-]*\.(unit|integration|e2e|functional|acceptance)?tests?\//.test(lower) ||
    // Java/Gradle test source sets beyond src/test: src/testFixtures, src/integrationTest.
    /(^|\/)src\/(test\w*|integration\w*)\//.test(lower) ||
    /\.(test|spec)\./.test(lower) ||
    // Helper packages named for tests rather than in a tests/ folder: Go's
    // `apitest/`, `dbtest/`, `testutil/`; a hardcoded mock key there is a fixture.
    /(^|\/)((api|db|unit|integration|load|perf|smoke|contract|snapshot|e2e)tests?|testutils?|testing|testhelpers?|mocks?)\//.test(lower) ||
    // Language conventions that aren't `.test.`: Go's `x_test.go` (flagged a
    // credential-masking regression test in ai-cost-guard as a HIGH leak),
    // Python's `test_x.py` / `x_test.py`, and JVM/.NET `FooTest(s).java|cs|kt`.
    /_test\.(go|py)$/.test(lower) ||
    // Rust test modules split into their own file (`mod http_tests;`). Missing this
    // let Idari's test fixtures - `[HttpPost("/health")]` in http_tests.rs - satisfy
    // "has a health endpoint" for a server that has none: a silent false negative.
    /_tests?\.rs$/.test(lower) ||
    /(^|\/)test_[^/]*\.py$/.test(lower) ||
    /tests?\.(java|kt|cs)$/.test(lower)
  );
}

const testStarts = new WeakMap<SourceFile, number>();

/**
 * Rust keeps unit tests inside the source file, after `#[cfg(test)]` - there is no
 * test *path* to exclude. Lines from there on are test code, the in-file
 * equivalent of Go's `x_test.go`. db-guard's `postgresql://u:p@h:5432/db` - a
 * dummy URL in a `#[test]` fn - was reported as a HIGH committed credential.
 */
export function isTestLine(file: SourceFile, lineIndex: number): boolean {
  if (!file.relPath.endsWith(".rs")) return false;
  let start = testStarts.get(file);
  if (start === undefined) {
    // Only `#[cfg(test)]` on a *module* starts the test section. On a single
    // item (`#[cfg(test)] use ...;` near the top) it covers that item alone -
    // treating the rest of the file as tests hid a real credential below it.
    const lines = file.content.split("\n");
    start = lines.findIndex((l, i) => /^\s*#\[cfg\(test\)\]/.test(l) && /^\s*(pub(\([^)]*\))?\s+)?mod\s+\w+/.test(lines[i + 1] ?? ""));
    testStarts.set(file, start);
  }
  return start !== -1 && lineIndex >= start;
}

/**
 * Client-side JavaScript. Browser code talks to its own backend, and "a slow
 * dependency holds your threads open" is server-side reasoning - a browser tab
 * has no thread pool to exhaust.
 */
export function isBrowserPath(relPath: string): boolean {
  const lower = relPath.toLowerCase();
  if (!/\.(js|mjs|cjs|ts|jsx|tsx)$/.test(lower)) return false;
  // `web/` and `www/` count only because the extension check above already
  // limits this to JS/TS - Idari's `src/web/mod.rs` is a Rust server, not a page.
  return /\.(jsx|tsx)$/.test(lower) || /(^|\/)(static|public|assets|wwwroot|www|web|frontend|client)\//.test(lower);
}

/** Runs on the client: a browser path, or JS/TS inside a frontend app's folder - unless it's that app's server code. */
export function isClientCode(repo: RepoSnapshot, file: SourceFile): boolean {
  if (!/\.(js|mjs|cjs|ts|jsx|tsx)$/i.test(file.relPath)) return false;
  if (isFrameworkServerFile(file)) return false;
  if (isBrowserPath(file.relPath)) return true;
  return (repo.frontendRoots ?? []).some((root) => root === "" || file.relPath.startsWith(`${root}/`));
}

/**
 * Generated code: nobody wrote it, nobody should hand-edit it, so grading it is
 * noise. Found on a real .NET repo: a 3584-line EF Core migration `.Designer.cs`
 * reported as the repo's biggest god-file.
 */
export function isGeneratedFile(file: SourceFile): boolean {
  const lower = file.relPath.toLowerCase();
  if (/\.designer\.cs$|modelsnapshot\.cs$|\.g\.cs$|\.g\.i\.cs$|\.generated\.\w+$|_pb2(_grpc)?\.py$|\.pb(\.gw)?\.go$|_gen\.go$/.test(lower)) return true;
  // Migration scripts written by a tool: Alembic (`alembic/versions/`, "Revision ID:"
  // header) and Django (`migrations/0001_initial.py`). A 400-line Alembic initial
  // schema was reported as a real repo's god-file.
  if (/(^|\/)alembic\/versions\/[^/]+\.py$/.test(lower) || /(^|\/)migrations\/\d{4}_\w+\.py$/.test(lower)) return true;
  // Vendored UI kits (shadcn/ui): copied in by a CLI, not written by hand - a
  // 726-line sidebar.tsx was reported as a real repo's god-file. Recognised by
  // its folder plus the libraries every shadcn component imports.
  if (/(^|\/)components\/ui\//.test(lower) && /@radix-ui\/|class-variance-authority/.test(file.content.slice(0, 2000))) return true;
  // Each ecosystem's standard marker, which tools write in the first lines.
  return /<auto-generated|@generated|Code generated .* DO NOT EDIT|DO NOT EDIT|auto-generated by/i.test(file.content.slice(0, 600));
}

/**
 * One-off data loaders - seeders, migrations, backfills, fixtures. They read small
 * lookup tables once at startup, so "this query returns every row" says nothing
 * about a list endpoint growing with traffic. Matches delimited words (`seeds/`,
 * `db_seed.rb`, `migrate/`) and CamelCase parts (`DatabaseSeeder.cs`), but not a
 * word that merely starts the same (`Seedling.cs`).
 */
export function isOneOffLoader(relPath: string): boolean {
  // dev_utils / dev-utils / devutils: development-only helpers that build a local database
  // (rust-web-app's _dev_utils/dev_db.rs runs a SQL file statement by statement - a loop
  // of queries that never runs on a request path).
  const delimited = /(^|[/_.-])(seed(er|ers|ing|s)?|migrat(e|ion|ions)|backfill\w*|fixtures?|dbinit\w*|dev[_-]?utils?)([/_.-]|\.\w+$|$)/i;
  const camelCase = /(?:^|[/_.-]|[a-z])(Seed(er|ers|ing|s)?|Migrat(or|ion|ions)|Backfill\w*|Fixtures?)(?=[A-Z._/]|$)/;
  return delimited.test(relPath) || camelCase.test(relPath);
}

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".java", ".kt", ".cs", ".py", ".rb", ".go", ".rs", ".php"]);

/** Source files only - excludes manifests, config, generated code, and anything under a test directory. */
export function codeFiles(repo: RepoSnapshot): SourceFile[] {
  return repo.files.filter((f) => CODE_EXTENSIONS.has(path.extname(f.relPath).toLowerCase()) && !isTestPath(f.relPath) && !isGeneratedFile(f));
}
