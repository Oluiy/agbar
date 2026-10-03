import { parametersAt } from "./params.js";
import { codeFiles, fileLineCounts, lineMatchesCode } from "./repo.js";
import type { RuleDefinition } from "./types.js";

/**
 * Structural rules: can this still be modified in six months, by a person,
 * without asking an AI to rewrite the file?
 *
 * The operational rules ask whether the service survives traffic. These ask
 * whether it stays changeable - which is the property that decides whether the
 * next developer edits the one rule they came for or regenerates the lot.
 */

export const STRUCTURAL_RULES: RuleDefinition[] = [
  {
    id: "handler-touches-database",
    conceptId: "dependency-inversion",
    severity: "medium",
    passSummary: "Request handlers don't talk to the database directly",
    nextStep:
      "Move the raw client/session call out of the handler and behind a small interface (a repository or store) the handler calls instead. The handler ends up describing what it needs, not how to get it.",
    appliesTo: (repo) => repo.hasDatabase,
    detect: (repo) => {
      // Deliberately targets raw clients/sessions/SQL, not an injected repository -
      // injecting a repository into a controller is common and defensible; opening a
      // connection or writing SQL there is the actual layering break.
      const rawDbUse =
        /\b(new (Pool|Client|MongoClient)|createConnection|getConnection|EntityManager|JdbcTemplate|DbContext|session\.query|knex\(|\bSELECT\s+.+\s+FROM\b)/i;

      for (const file of codeFiles(repo)) {
        // Filename suffix used to only recognize .js/.ts, so handler.rs,
        // handler.go, and handler.py were invisible to this rule outside a
        // controllers/-named folder - any extension, same stem words.
        const isHandler =
          /(^|\/)(controllers?|handlers?|routes?|resources?)\//i.test(file.relPath) ||
          /(controller|handler|route)\.\w+$|Controller\.(java|cs|kt)$/i.test(file.relPath);
        if (!isHandler) continue;
        const lines = file.content.split("\n");
        const i = lines.findIndex((l) => rawDbUse.test(l));
        if (i !== -1) {
          return {
            ruleId: "handler-touches-database",
            conceptId: "dependency-inversion",
            severity: "medium",
            summary:
              "A request handler talks to the database directly - the transport layer and the storage detail are welded together, so neither can change or be tested alone.",
            evidence: `${file.relPath}:${i + 1}  ${lines[i].trim().slice(0, 100)}`,
          };
        }
      }
      return undefined;
    },
  },
  {
    id: "god-file",
    conceptId: "single-responsibility",
    severity: "low",
    passSummary: "No oversized source files",
    nextStep:
      "Look for natural seams: does this file mix rendering, data-fetching, and event-handling (or their language equivalents)? Each concern is a candidate module. Start by extracting the piece you're about to touch next, not by planning a full rewrite.",
    appliesTo: (repo) => codeFiles(repo).length > 0,
    detect: (repo) => {
      const LIMIT = 500;
      // Sorted descending: index 0 is the worst offender, the rest are the
      // comparison set that makes "1217 lines" mean something concrete instead
      // of just a number against an arbitrary threshold.
      const counts = fileLineCounts(repo).sort((a, b) => b.lines - a.lines);
      const worst = counts[0];
      if (!worst || worst.lines <= LIMIT) return undefined;

      const rest = counts
        .slice(1)
        .map((c) => c.lines)
        .sort((a, b) => a - b);
      const comparison =
        rest.length > 0
          ? ` The next-largest file in this repo is ${counts[1].lines} lines (median across the rest: ${rest[Math.floor(rest.length / 2)]}).`
          : "";

      return {
        ruleId: "god-file",
        conceptId: "single-responsibility",
        severity: "low",
        summary: `A source file is ${worst.lines} lines. Past roughly ${LIMIT} it's usually several responsibilities sharing a file, which is what makes a change hard to review and hard to make safely.${comparison}`,
        evidence: worst.relPath,
      };
    },
  },
  {
    id: "too-many-dependencies",
    conceptId: "coupling-and-cohesion",
    severity: "low",
    passSummary: "No constructor takes an unusual number of dependencies",
    nextStep:
      "Group the constructor's dependencies by which feature they serve. Each group that only ever gets used together is a class trying to split itself out - move it into its own collaborator and inject that instead.",
    appliesTo: (repo) => codeFiles(repo).length > 0,
    detect: (repo) => {
      const LIMIT = 7;
      // The original pattern only recognized Java/C#/TS-style constructors, so
      // it silently never fired for Rust, Go, or Python at all - not "quiet by
      // design," just never checked. `fn new(`, `func New*(`, and `__init__(`
      // are each language's idiomatic constructor convention.
      const constructorStart = /\bconstructor\s*\(|\bpublic\s+[A-Z]\w*\s*\(|\bfn\s+new\s*\(|\bfunc\s+New\w*\s*\(|\bdef\s+__init__\s*\(/;
      // Data carriers take one constructor argument per field - that's their job,
      // not a sign of doing too much. A 6-field `BudgetResponse` DTO record was
      // flagged as a class with too many dependencies.
      const dataCarrierPath = /(^|\/)(dtos?|models?|entities|entity|requests?|responses?|viewmodels?|contracts)\//i;
      for (const file of codeFiles(repo)) {
        if (dataCarrierPath.test(file.relPath)) continue;
        // Python dataclasses and Kotlin data classes generate their constructors,
        // so a hand-written one in the same file belongs to something else.
        if (/@dataclass\b|\bdata\s+class\s+[A-Z]/.test(file.content) && !/\bdef\s+__init__|\bconstructor\s*\(/.test(file.content)) continue;
        const lines = file.content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          // C# 12 and Kotlin put the constructor on the class line: `class S(IA a, IB b)`.
          // Only there - in Python `class S(Base, Mixin)` is an inheritance list.
          const primaryCtor = /\.(cs|kt)$/.test(file.relPath) && /\b(class|struct)\s+[A-Z]\w*\s*\(/.test(lines[i]);
          if (!primaryCtor && !lineMatchesCode(file, i, constructorStart)) continue;
          // Parse the real parameter list: multi-line signatures, generics and
          // function-typed parameters all counted correctly (see params.ts).
          const params = parametersAt(lines, i);
          if (!params || params.length === 0) continue;
          // Whose constructor is this? If that type is a record, it's a data
          // carrier taking one argument per field - not dependency injection.
          const owner = /\bpublic\s+([A-Z]\w*)\s*\(/.exec(lines[i])?.[1];
          if (owner && new RegExp(`\\brecord\\s+(?:class\\s+|struct\\s+)?${owner}\\b`).test(file.content)) continue;
          const count = params.length;
          if (count >= LIMIT) {
            return {
              ruleId: "too-many-dependencies",
              conceptId: "coupling-and-cohesion",
              severity: "low",
              summary: `A constructor takes ${count} dependencies. That usually means the class is doing several jobs, and it's the cheapest signal that something should be split.`,
              evidence: `${file.relPath}:${i + 1}`,
            };
          }
        }
      }
      return undefined;
    },
  },
];
