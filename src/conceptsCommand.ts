import pc from "picocolors";
import { codeBlock, emphasize } from "./terminalText.js";
import { command, dim, heading, label, name, nextStep, path, tag } from "./ui/palette.js";
import { BACKEND_CONCEPTS, type Concept } from "./concepts/index.js";

/**
 * Powers `buildquick concepts` - a standalone glossary command, independent of
 * scaffolding a project. The gap this closes: ARCHITECTURE.md/LEVELING-UP.md
 * only exist the moment a project gets generated, but the decisions they cover
 * (caching, rate limiting, idempotency, ...) come up constantly afterward, while
 * writing the actual business logic. This makes that same content one command
 * away, any time, with no project required.
 */

export type ConceptLookup = { kind: "match"; concept: Concept } | { kind: "ambiguous"; candidates: Concept[] } | { kind: "none" };

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

  // Nothing in a title: search what the concepts say, so a plain word works -
  // "concepts money" finds float money, rounding and big IDs. Ranked by how
  // often the word appears, most relevant first.
  const word = new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gi");
  const hits = BACKEND_CONCEPTS.map((c) => ({ c, n: `${c.category} ${c.failureScenario} ${c.fix} ${c.example ?? ""}`.match(word)?.length ?? 0 }))
    .filter((h) => h.n > 0)
    .sort((a, b) => b.n - a.n)
    .map((h) => h.c);
  if (hits.length === 1) return { kind: "match", concept: hits[0] };
  if (hits.length > 1) return { kind: "ambiguous", candidates: hits.slice(0, 8) };
  return { kind: "none" };
}

export function printConceptsList(): void {
  const byCategory = new Map<string, Concept[]>();
  for (const c of BACKEND_CONCEPTS) {
    const list = byCategory.get(c.category) ?? [];
    list.push(c);
    byCategory.set(c.category, list);
  }

  console.log(`\n${heading("Concepts")} ${dim(`${BACKEND_CONCEPTS.length} across ${byCategory.size} topics - the stuff tutorials skip`)}`);
  console.log(`${label("Quicker:")} search with one word - ${command("buildquick concepts money")}  ${command("buildquick concepts timeout")}\n`);
  for (const [category, items] of byCategory) {
    console.log(`${pc.bold(category)} ${dim(`(${items.length})`)}`);
    // The id is what you type to open it - so it's the coloured column, lined up.
    const width = Math.max(...items.map((c) => c.title.length));
    for (const c of items) {
      console.log(`  ${c.title.padEnd(width)}  ${command(c.id)}`);
    }
    console.log("");
  }
  console.log(nextStep("open one:", "buildquick concepts <id>"));
}

export function printConceptDetail(query: string): void {
  const result = lookupConcept(query);

  if (result.kind === "none") {
    console.error(pc.red(`Nothing about '${query}' yet.`) + ` Try a different word, or ${command("buildquick concepts")} to browse everything.`);
    process.exitCode = 1;
    return;
  }

  // Several matches is a search result, not a mistake - list them with the
  // exact command to open each, so there's nothing to work out.
  if (result.kind === "ambiguous") {
    console.log(`\n${heading(`${result.candidates.length} concepts about '${query}'`)}\n`);
    for (const c of result.candidates) {
      console.log(`  ${name(c.title)} ${tag(`[${c.category}]`)}\n  ${command(`buildquick concepts ${c.id}`)}\n`);
    }
    return;
  }

  const { concept } = result;
  // One palette (ui/palette.ts): red = what goes wrong, green = what to do, the
  // judgement call stands out, code is a headed block. Every section has a bold
  // heading, so the structure survives a terminal with no colour at all.
  console.log(`\n${heading(concept.title)}`);
  console.log(`${tag(`[${concept.category}]`)}\n`);
  console.log(`${pc.bold(pc.red("Where this bites you"))}\n${emphasize(concept.failureScenario)}\n`);
  console.log(`${pc.bold(pc.green("The fix"))}\n${emphasize(concept.fix)}\n`);

  // Only printed when the concept actually has a judgement call in it - most
  // don't, and an empty "when to use" heading would be worse than no heading.
  if (concept.whenToUse) console.log(`${pc.bold(pc.magenta("When to reach for it"))}\n${emphasize(concept.whenToUse)}\n`);

  if (concept.example) console.log(`${heading("In code")}\n\n${codeBlock(concept.example)}\n`);
  // Labelled per runtime: the same mistake wears a different face in each, and a reader
  // scanning for their own stack should find it without translating someone else's.
  for (const ex of concept.examples ?? []) {
    console.log(`${heading(`In code - ${ex.language}`)}\n\n${codeBlock(ex.code)}\n`);
  }

  if (concept.references?.length) {
    console.log(heading("Read more"));
    for (const ref of concept.references) console.log(`  ${ref.title}\n  ${path(ref.url)}`);
    console.log("");
  }

  // Every screen ends on one next step: practise it if a lesson exists, else keep browsing.
  console.log(concept.practice ? nextStep("practise it:", concept.practice) : nextStep("browse more:", "buildquick concepts"));
}
