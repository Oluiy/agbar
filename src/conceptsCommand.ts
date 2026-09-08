import pc from "picocolors";
import { BACKEND_CONCEPTS, type Concept } from "./concepts.js";

/**
 * Powers `buildquick concepts` - a standalone glossary command, independent of
 * scaffolding a project. The gap this closes: ARCHITECTURE.md/LEVELING-UP.md
 * only exist the moment a project gets generated, but the decisions they cover
 * (caching, rate limiting, idempotency, ...) come up constantly afterward, while
 * writing the actual business logic. This makes that same content one command
 * away, any time, with no project required.
 */

export type ConceptLookup =
  | { kind: "match"; concept: Concept }
  | { kind: "ambiguous"; candidates: Concept[] }
  | { kind: "none" };

/**
 * Exact id/title match always wins outright - it can never be ambiguous.
 * A substring match ("queue" -> message-queues AND dead-letter-queues) is
 * reported as ambiguous instead of silently returning whichever happened to
 * be declared first in BACKEND_CONCEPTS.
 */
export function lookupConcept(query: string): ConceptLookup {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  const qDashed = q.replace(/ /g, "-");

  const exact = BACKEND_CONCEPTS.find((c) => c.id === qDashed || c.title.toLowerCase() === q);
  if (exact) return { kind: "match", concept: exact };

  const partial = BACKEND_CONCEPTS.filter((c) => c.title.toLowerCase().includes(q) || c.id.includes(qDashed));
  if (partial.length === 1) return { kind: "match", concept: partial[0] };
  if (partial.length > 1) return { kind: "ambiguous", candidates: partial };
  return { kind: "none" };
}

export function printConceptsList(): void {
  const byCategory = new Map<string, Concept[]>();
  for (const c of BACKEND_CONCEPTS) {
    const list = byCategory.get(c.category) ?? [];
    list.push(c);
    byCategory.set(c.category, list);
  }

  console.log(pc.bold(`\n${BACKEND_CONCEPTS.length} backend concepts - the stuff tutorials skip:\n`));
  for (const [category, items] of byCategory) {
    console.log(pc.cyan(pc.bold(category)));
    for (const c of items) {
      console.log(`  ${pc.bold(c.title)} ${pc.dim(`(${c.id})`)}`);
    }
    console.log("");
  }
  console.log(pc.dim("Run 'buildquick concepts <name>' for the full explanation, e.g. 'buildquick concepts rate limiting'."));
}

export function printConceptDetail(query: string): void {
  const result = lookupConcept(query);

  if (result.kind === "none") {
    console.error(pc.red(`No concept matches '${query}'. Run 'buildquick concepts' to see the full list.`));
    process.exitCode = 1;
    return;
  }

  if (result.kind === "ambiguous") {
    console.error(pc.yellow(`'${query}' matches more than one concept - be more specific:`));
    for (const c of result.candidates) {
      console.error(`  ${c.title} (${c.id})`);
    }
    process.exitCode = 1;
    return;
  }

  const { concept } = result;
  console.log(`\n${pc.bold(concept.title)} ${pc.dim(`[${concept.category}]`)}\n`);
  console.log(`${pc.yellow("Where this bites you:")} ${concept.failureScenario}\n`);
  console.log(`${pc.green("The fix:")} ${concept.fix}\n`);
}
