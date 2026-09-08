import { describe, expect, it } from "vitest";
import { BACKEND_CONCEPTS } from "./concepts.js";
import { renderLevelingUpDoc } from "./conceptsRender.js";

describe("BACKEND_CONCEPTS", () => {
  it("has exactly the 27 concepts every backend engineer eventually needs", () => {
    expect(BACKEND_CONCEPTS).toHaveLength(27);
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

  it("covers idempotency, indexing, caching, queues, retries, DLQs, circuit breakers, reconciliation, and CAP theorem", () => {
    const ids = BACKEND_CONCEPTS.map((c) => c.id);
    expect(ids).toEqual([
      "idempotency-keys",
      "database-indexing",
      "caching",
      "message-queues",
      "retry-mechanisms",
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
      "pagination",
      "n-plus-one-queries",
      "distributed-locks",
      "concurrency-control",
      "backpressure",
      "bulkhead-pattern",
      "backups-vs-replication",
      "multi-tenancy",
    ]);
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
