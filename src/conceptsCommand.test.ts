import { describe, expect, it } from "vitest";
import { lookupConcept } from "./conceptsCommand.js";

describe("lookupConcept", () => {
  it("matches by exact id", () => {
    const result = lookupConcept("rate-limiting");
    expect(result.kind).toBe("match");
    expect(result.kind === "match" && result.concept.id).toBe("rate-limiting");
  });

  it("matches by exact title, case-insensitive", () => {
    const result = lookupConcept("Rate Limiting");
    expect(result.kind === "match" && result.concept.id).toBe("rate-limiting");
    const result2 = lookupConcept("cap theorem");
    expect(result2.kind === "match" && result2.concept.id).toBe("cap-theorem");
  });

  it("matches an unambiguous title substring", () => {
    const result = lookupConcept("dead letter");
    expect(result.kind === "match" && result.concept.id).toBe("dead-letter-queues");
  });

  it("reports 'queue' as ambiguous between message-queues and dead-letter-queues, instead of silently picking one", () => {
    const result = lookupConcept("queue");
    expect(result.kind).toBe("ambiguous");
    const ids = result.kind === "ambiguous" ? result.candidates.map((c) => c.id).sort() : [];
    expect(ids).toEqual(["dead-letter-queues", "message-queues"]);
  });

  it("an exact id match wins even when it would otherwise also be a substring of another concept", () => {
    const result = lookupConcept("message-queues");
    expect(result.kind === "match" && result.concept.id).toBe("message-queues");
  });

  it("returns none for no match", () => {
    expect(lookupConcept("blockchain").kind).toBe("none");
  });
});
