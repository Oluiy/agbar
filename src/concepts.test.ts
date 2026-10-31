import { describe, expect, it } from "vitest";
import { BACKEND_CONCEPTS } from "./concepts/index.js";
import { renderLevelingUpDoc } from "./conceptsRender.js";
import { RULES } from "./check/rules.js";
import { loadUnits } from "./learn/loader.js";

describe("BACKEND_CONCEPTS", () => {
  // No magic number here on purpose. The list of ids below IS the contract - adding a
  // concept fails that test with a readable diff naming it - and a hand-maintained count
  // in three places only ever drifts. This checks the two agree with each other.
  it("has no duplicate ids, and every concept is accounted for in the id list below", () => {
    const ids = BACKEND_CONCEPTS.map((c) => c.id);
    expect(new Set(ids).size, "two concepts share an id").toBe(ids.length);
  });

  it("every 'practise it' command points at a lesson unit that really exists", () => {
    for (const c of BACKEND_CONCEPTS.filter((x) => x.practice)) {
      const m = /^agbar learn (\S+) (\S+)$/.exec(c.practice!);
      expect(m, `${c.id}: practice must be 'agbar learn <language> <unit-id>'`).not.toBeNull();
      const ids = loadUnits(m![1]).map((u) => u.id);
      expect(ids, `${c.id}: no unit '${m![2]}' in ${m![1]}`).toContain(m![2]);
    }
  });

  it("every concept has a code example - a glossary teaches words, an example teaches the thing", () => {
    // Either one shared snippet, or one per runtime for concepts that look different in each.
    expect(BACKEND_CONCEPTS.filter((c) => !c.example && !c.examples?.length).map((c) => c.id)).toEqual([]);
  });

  it("per-runtime examples are labelled and non-empty, so a reader can find their own stack", () => {
    for (const c of BACKEND_CONCEPTS.filter((x) => x.examples?.length)) {
      for (const ex of c.examples!) {
        expect(ex.language.trim(), `${c.id}: an example has no language label`).not.toBe("");
        expect(ex.code.trim().length, `${c.id}/${ex.language}: empty example`).toBeGreaterThan(20);
      }
    }
  });

  it("every JavaScript example at least parses - a typo in teaching code teaches the typo", () => {
    // Constructing an AsyncFunction parses the body without running it - in
    // process, so no child processes to time out under a busy test run.
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (body: string) => unknown;
    const looksLikeJs = (code: string) => /^(\/\/|const |import |app\.|if |process\.|async |for |await )/.test(code);
    // Per-runtime examples are checked too: a JS snippet is no safer for sitting in
    // `examples` rather than `example`, and that is where the Node versions now live.
    const jsExamples = BACKEND_CONCEPTS.flatMap((c) => [
      ...(c.example && looksLikeJs(c.example) ? [{ id: c.id, example: c.example }] : []),
      ...(c.examples ?? [])
        .filter((ex) => /Node|JavaScript|TypeScript/i.test(ex.language) && looksLikeJs(ex.code))
        .map((ex) => ({ id: `${c.id} (${ex.language})`, example: ex.code })),
    ]);
    expect(jsExamples.length).toBeGreaterThan(15);
    for (const c of jsExamples) {
      // Snippets are fragments: wrap them in an async function so a top-level
      // `return` or `await` parses, and drop imports, which can't live in one.
      // Some examples compare languages (JS, then Go, then Python). Only the JS
      // part is JS: stop at the first "// Go" / "# Python" style section header.
      const lines = c.example.split("\n");
      const otherLanguage = lines.findIndex((l) => /^(\/\/|#) ?(Go|Python|C#|Java|Rust)\b/.test(l));
      const body = (otherLanguage === -1 ? lines : lines.slice(0, otherLanguage))
        .filter((l) => !/^import /.test(l))
        .map((l) => l.replace(/^export /, ""))
        .join("\n");
      try {
        new AsyncFunction(`"use strict";\n${body}`);
      } catch (err) {
        throw new Error(`${c.id}: example doesn't parse - ${(err as Error).message}`);
      }
    }
  });

  it("every concept a check finding links to is among them - that's where a beginner lands", () => {
    const ids = new Set(BACKEND_CONCEPTS.map((c) => c.id));
    expect(RULES.map((r) => r.conceptId).filter((id) => !ids.has(id))).toEqual([]);
  });

  it("every concept has a unique id and every field filled in", () => {
    const ids = BACKEND_CONCEPTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of BACKEND_CONCEPTS) {
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.category.length).toBeGreaterThan(0);
      expect(c.failureScenario.length).toBeGreaterThan(0);
      expect(c.fix.length).toBeGreaterThan(0);
    }
  });

  // Membership, not order: concepts are grouped into themed files under
  // src/concepts/, so the array order follows those groups rather than the order
  // they happened to be written in. What must stay stable is that every one of
  // them is still present.
  it("covers every concept, from idempotency and indexing through to the structural set", () => {
    const ids = [...BACKEND_CONCEPTS.map((c) => c.id)].sort();
    expect(ids).toEqual(
      [
        "supply-chain-security",
        "injection",
        "object-level-authorization",
        "authentication-failures",
        "error-handling",
        "cancellation-propagation",
        "prompt-injection",
        "idempotency-keys",
        "database-indexing",
        "caching",
        "message-queues",
        "retry-mechanisms",
        "timeouts",
        "dead-letter-queues",
        "circuit-breakers",
        "reconciliation",
        "cap-theorem",
        "statelessness",
        "connection-pooling",
        "security-by-design",
        "observability",
        "api-versioning",
        "communication-patterns",
        "choosing-the-datastore",
        "rate-limiting",
        "replication",
        "secrets-management",
        "dependency-inversion",
        "single-responsibility",
        "separation-of-concerns",
        "coupling-and-cohesion",
        "dry-principle",
        "pagination",
        "n-plus-one-queries",
        "distributed-locks",
        "concurrency-control",
        "backpressure",
        "bulkhead-pattern",
        "backups-vs-replication",
        "multi-tenancy",
        "microservices-vs-monolith",
        "cache-warming",
        "cache-stampede",
        "transactional-outbox",
        "saga-pattern",
        "schema-migrations",
        "graceful-shutdown",
        "feature-flags",
        // Small traps: text, numbers, time (trapsData.ts)
        "unicode-normalization",
        "string-length",
        "locale-case-mapping",
        "invisible-characters",
        "regex-anchoring",
        "redos",
        "floating-point-money",
        "big-integer-ids",
        "integer-overflow",
        "nan-and-infinity",
        "rounding-modes",
        "falsy-zero",
        "monotonic-clocks",
        "daylight-saving-time",
        "week-based-year",
        "leap-days",
        // Small traps: HTTP, SQL, runtime, input, files, serialization (trapsSystems.ts)
        "http-method-semantics",
        "socket-exhaustion",
        "dns-caching",
        "spreading-built-in-objects",
        "sql-null-logic",
        "collation-uniqueness",
        "deadlock-lock-order",
        "captive-dependencies",
        "disposable-leaks",
        "non-atomic-updates",
        "sync-over-async",
        "mass-assignment",
        "timing-attacks",
        "ssrf",
        "path-traversal",
        "atomic-file-writes",
        "filesystem-case-sensitivity",
        "file-descriptor-leaks",
        "schema-evolution",
      ].sort()
    );
  });

  it("puts the design concepts first, since structure decides whether the rest can be changed later", () => {
    expect(BACKEND_CONCEPTS[0].category).toBe("Design");
  });

  it("every reference is a real https URL with a title, not a bare link", () => {
    for (const c of BACKEND_CONCEPTS) {
      for (const ref of c.references ?? []) {
        expect(ref.title.length, `${c.id} has an untitled reference`).toBeGreaterThan(0);
        expect(ref.url, `${c.id} reference '${ref.title}' isn't https`).toMatch(/^https:\/\//);
      }
    }
  });

  // whenToUse exists to carry a real judgement call. A one-liner that just
  // restates the fix is filler, and filler is what makes people stop reading.
  it("every whenToUse that exists is substantive, not a restatement of the fix", () => {
    for (const c of BACKEND_CONCEPTS) {
      if (!c.whenToUse) continue;
      expect(c.whenToUse.length, `${c.id}'s whenToUse is too short to say anything`).toBeGreaterThan(80);
      expect(c.whenToUse, `${c.id}'s whenToUse just repeats its fix`).not.toBe(c.fix);
    }
  });

  it("the concepts that are pure decisions actually carry a whenToUse", () => {
    const decisionConcepts = ["microservices-vs-monolith", "cache-warming", "cache-stampede", "rate-limiting", "saga-pattern"];
    for (const id of decisionConcepts) {
      expect(BACKEND_CONCEPTS.find((c) => c.id === id)?.whenToUse, `${id} has no whenToUse`).toBeTruthy();
    }
  });
});

describe("renderLevelingUpDoc", () => {
  it("includes every concept's title and is honest that none of it is in the generated code", () => {
    const doc = renderLevelingUpDoc("MyApi");
    for (const c of BACKEND_CONCEPTS) {
      expect(doc).toContain(c.title);
    }
    expect(doc).toContain("MyApi");
    expect(doc.toLowerCase()).toContain("none of this is in the code you just generated");
  });
});
