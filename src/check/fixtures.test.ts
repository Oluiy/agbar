import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCheck } from "./runner.js";
import { scanRepo } from "./repo.js";

/**
 * Real-world-shaped fixtures with manually labeled expected behavior - the
 * measurement baseline the maintainer notes's robustness plan is judged against.
 *
 * Every assertion here documents CURRENT behavior, correct or not. Where
 * current behavior is a known bug, the test says so explicitly and names the
 * phase that fixes it - when that phase lands, the assertion (not the
 * fixture) should flip, and this comment should be deleted.
 *
 * Baseline as of writing: 2 known issues remaining across 5 fixtures (2 fixed).
 * - FIXED (3.1):       env-not-ignored used to fire despite a nested .gitignore covering it
 * - FIXED (3.2):       no-rate-limiting was suppressed by an unrelated lodash throttle
 * - 1 false positive:  query-in-loop fires on a small bounded admin loop
 * - 1 off-by-one:      too-many-dependencies counts Python's `self` as a dependency
 */

const FIXTURES_ROOT = path.join(__dirname, "..", "..", "test-fixtures");

function findingIds(fixture: string): string[] {
  const repo = scanRepo(path.join(FIXTURES_ROOT, fixture));
  return runCheck(repo).findings.map((f) => f.ruleId);
}

describe("monorepo-nested-env", () => {
  // FIXED - Phase 3.1. apps/api/.gitignore covers apps/api/.env even though
  // the root has no .gitignore at all.
  it("correctly passes: the nested .gitignore covers the nested .env", () => {
    expect(findingIds("monorepo-nested-env")).toEqual([]);
  });
});

describe("lodash-throttle-only", () => {
  // FIXED - Phase 3.2. `throttle` as a bare word is no longer evidence of
  // anything; only real limiter symbols and package names count. Asserted as an
  // exact set on purpose, so it pins both directions at once: the missing
  // limiter is flagged, and the genuine `/health` route still suppresses
  // no-healthcheck rather than the fix over-correcting into a false positive.
  it("flags the missing rate limiter, and isn't fooled by an unrelated lodash throttle", () => {
    expect(findingIds("lodash-throttle-only")).toEqual(["no-rate-limiting"]);
  });
});

describe("spring-minimal", () => {
  it("flags a 7-collaborator constructor (correct - no bug)", () => {
    expect(findingIds("spring-minimal")).toEqual(["too-many-dependencies"]);
  });

  it("correctly skips connection-pool-config - Spring Data JPA ships HikariCP by default", () => {
    const repo = scanRepo(path.join(FIXTURES_ROOT, "spring-minimal"));
    expect(runCheck(repo).skipped).toContain("no-connection-pool-config");
  });
});

describe("express-realworld", () => {
  it("flags a real unbounded SELECT * (correct - no bug)", () => {
    expect(findingIds("express-realworld")).toContain("unbounded-list-query");
  });

  // KNOWN BUG - Phase 3.4 (loop-variable heuristic). This loop iterates over a
  // small, bounded admin-time list of table names, not row-scale data - but
  // the rule can't yet tell that apart from a real N+1.
  it("currently flags query-in-loop on a small bounded admin loop, not just row-scale loops", () => {
    expect(findingIds("express-realworld")).toContain("query-in-loop");
  });
});

describe("python-fastapi", () => {
  // KNOWN BUG - Phase 3.5 (language-aware thresholds). 6 real collaborators +
  // self = 7 counted, which meets the LIMIT=7 threshold one dependency early.
  it("currently counts self as a dependency, flagging 6 real params as too-many-dependencies", () => {
    expect(findingIds("python-fastapi")).toContain("too-many-dependencies");
  });
});
