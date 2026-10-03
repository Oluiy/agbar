import { cronMatches, parseCron } from "./cron.js";
import type { YamlAssertion } from "./types.js";

/**
 * Evaluates YamlAssertions against an already-parsed document. Pure - no file
 * access - so every rule here is testable without a workspace.
 */

interface Lookup {
  found: boolean;
  value: unknown;
}

/** `jobs.test.steps[0].uses` -> ["jobs", "test", "steps", 0, "uses"]. */
function segments(path: string): (string | number)[] {
  return (path.match(/[^.[\]]+|\[\d+\]/g) ?? []).map((s) => (s.startsWith("[") ? Number(s.slice(1, -1)) : s));
}

/**
 * Distinguishes "missing" from "present but empty". `workflow_dispatch:` parses
 * to null, and it is still a real, meaningful key - a plain `value === undefined`
 * check would call it missing.
 */
export function lookup(root: unknown, path: string): Lookup {
  let current: unknown = root;
  for (const seg of segments(path)) {
    if (typeof seg === "number") {
      if (!Array.isArray(current) || seg >= current.length) return { found: false, value: undefined };
      current = current[seg];
    } else {
      if (current === null || typeof current !== "object" || Array.isArray(current) || !(seg in current)) {
        return { found: false, value: undefined };
      }
      current = (current as Record<string, unknown>)[seg];
    }
  }
  return { found: true, value: current };
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "list";
  if (typeof value === "object") return "map";
  return typeof value;
}

/** Key order in a YAML map carries no meaning, so it must not affect equality. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeOf(a) !== typeOf(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  if (typeOf(a) === "map") {
    const [ka, kb] = [Object.keys(a as object), Object.keys(b as object)];
    return ka.length === kb.length && ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

const TYPES = ["string", "number", "boolean", "list", "map", "null"];

function stringList(value: unknown, where: string, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || Number.isNaN(Date.parse(v)))) {
    throw new Error(`${where}: '${field}' must be a list of ISO 8601 UTC times, like "2026-09-21T09:30:00Z".`);
  }
  // Every element was just checked to be a string.
  return value as string[];
}

/**
 * Lesson YAML (snake_case) -> YamlAssertion[], failing loudly like the rest of
 * loader.ts. A typo'd check name would otherwise make an assertion that checks
 * nothing and always passes - the worst kind of grader bug, because it's silent.
 */
export function parseAssertions(raw: unknown, where: string): YamlAssertion[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error(`${where}: check_type 'yaml_assertions' requires a non-empty 'assertions' list.`);
  const known = new Set(["path", "message", "exists", "equals", "type", "matches", "has_item", "cron_fires", "cron_skips"]);

  return raw.map((entry, i) => {
    const at = `${where}.assertions[${i}]`;
    if (entry === null || typeof entry !== "object") throw new Error(`${at}: must be a map.`);
    const e = entry as Record<string, unknown>;
    const unknownKey = Object.keys(e).find((k) => !known.has(k));
    if (unknownKey) throw new Error(`${at}: unknown field '${unknownKey}'. Use: ${[...known].join(", ")}.`);
    if (typeof e.path !== "string") throw new Error(`${at}: 'path' must be a string ("" for the document root).`);
    if (typeof e.message !== "string" || !e.message) throw new Error(`${at}: missing 'message' - it's what the learner sees on failure.`);
    if (e.type !== undefined && !TYPES.includes(e.type as string)) throw new Error(`${at}: 'type' must be one of ${TYPES.join(", ")}.`);
    for (const re of [e.matches, ...Object.values((e.has_item as Record<string, unknown> | undefined) ?? {})]) {
      if (re !== undefined) {
        // A non-string would be coerced ("[object Object]" is a valid regex), so a typo'd
        // `matches: {a: 1}` used to pass validation and then match the wrong thing.
        if (typeof re !== "string") throw new Error(`${at}: a regex must be a string, got ${typeof re}.`);
        try {
          new RegExp(re);
        } catch {
          throw new Error(`${at}: invalid regex '${re}'.`);
        }
      }
    }
    const checks = ["exists", "equals", "type", "matches", "has_item", "cron_fires", "cron_skips"].filter((k) => e[k] !== undefined);
    if (checks.length === 0) throw new Error(`${at}: has no check (exists/equals/type/matches/has_item/cron_fires/cron_skips), so it would always pass.`);

    return {
      path: e.path,
      message: e.message,
      exists: typeof e.exists === "boolean" ? e.exists : undefined,
      equals: e.equals,
      type: e.type as YamlAssertion["type"],
      matches: e.matches as string | undefined,
      hasItem: e.has_item as Record<string, string> | undefined,
      cronFires: stringList(e.cron_fires, at, "cron_fires"),
      cronSkips: stringList(e.cron_skips, at, "cron_skips"),
    };
  });
}

/** Why an assertion failed, or undefined if it holds. */
export function failureOf(doc: unknown, a: YamlAssertion): string | undefined {
  const { found, value } = lookup(doc, a.path);
  const where = a.path || "the document";

  if (a.exists === false) return found ? `${where} should not be there.` : undefined;
  if (!found) return `${where} is missing.`;

  if (a.type !== undefined && typeOf(value) !== a.type) {
    return `${where} parsed as a ${typeOf(value)} (${JSON.stringify(value)}), expected a ${a.type}.`;
  }
  if (a.equals !== undefined && !deepEqual(value, a.equals)) {
    return `${where} is ${JSON.stringify(value)}, expected ${JSON.stringify(a.equals)}.`;
  }
  if (a.matches !== undefined && !new RegExp(a.matches).test(String(value))) {
    return `${where} is ${JSON.stringify(value)}.`;
  }
  if (a.hasItem !== undefined) {
    if (!Array.isArray(value)) return `${where} should be a list, but parsed as a ${typeOf(value)}.`;
    const wanted = Object.entries(a.hasItem);
    const hit = value.some((item) =>
      wanted.every(([sub, re]) => {
        const inner = lookup(item, sub);
        return inner.found && new RegExp(re).test(String(inner.value));
      })
    );
    if (!hit) return `no item in ${where} has ${wanted.map(([k, re]) => `${k} ~ /${re}/`).join(" and ")}.`;
  }
  if (a.cronFires !== undefined || a.cronSkips !== undefined) {
    if (typeof value !== "string") return `${where} should be a cron string, but parsed as a ${typeOf(value)}.`;
    let schedule;
    try {
      schedule = parseCron(value);
    } catch (err) {
      return `'${value}' isn't a valid cron expression: ${(err as Error).message}`;
    }
    const missed = (a.cronFires ?? []).find((iso) => !cronMatches(schedule, new Date(iso)));
    if (missed) return `'${value}' does not fire at ${missed} (UTC), but should.`;
    const extra = (a.cronSkips ?? []).find((iso) => cronMatches(schedule, new Date(iso)));
    if (extra) return `'${value}' fires at ${extra} (UTC), but shouldn't.`;
  }
  return undefined;
}
