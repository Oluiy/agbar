/**
 * The regex mistakes people make most - each small, each easy to overlook, each
 * a real bug. Spotted from the pattern's source alone, so `buildquick regex` can
 * warn before anything is run. Heuristics, worded as "check this", not verdicts.
 */

export interface Pitfall {
  severity: "danger" | "warning" | "note";
  message: string;
}

export function findPitfalls(source: string, flags: string): Pitfall[] {
  const found: Pitfall[] = [];

  // A quantified group that itself contains a quantifier: (a+)+, (\w*)*, (.*)+.
  // Each way of splitting the input is tried on failure - exponential time.
  if (/\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]/.test(source)) {
    found.push({
      severity: "danger",
      message:
        "A repeated group with a repeat inside it, like (a+)+, can take exponential time on input that almost matches (catastrophic backtracking / ReDoS). Usually one quantifier is enough: a+.",
    });
  }

  // ^cat|dog$ is (^cat)|(dog$) - the anchors bind to the alternatives, not the whole.
  if (/^\^[^()|]*\|/.test(source) || /\|[^()|]*\$$/.test(source)) {
    found.push({
      severity: "warning",
      message: '| has the lowest precedence: ^cat|dog$ means "starts with cat" OR "ends with dog", so it matches "category". Group it: ^(?:cat|dog)$.',
    });
  }

  // An unescaped . between letters is almost always a literal dot someone meant.
  if (/[a-z0-9]\.[a-z]/i.test(source.replace(/\\\./g, ""))) {
    found.push({
      severity: "warning",
      message: 'An unescaped . matches ANY character, so example.com also matches "exampleXcom". For a literal dot write \\.',
    });
  }

  if (!source.startsWith("^") && !source.endsWith("$")) {
    found.push({
      severity: "note",
      message: "No ^ or $: this matches anywhere inside the text. For validating a whole value (a zip code, an id), anchor it: ^...$.",
    });
  }

  if (/\.\*[^?)|$]/.test(source) || /\.\+[^?)|$]/.test(source)) {
    found.push({
      severity: "note",
      message:
        '.* and .+ are greedy - they grab as much as possible, then back off. <.+> on "<b>x</b>" matches the whole string. Lazy .*? stops at the first chance; a negated class like [^>]* is often clearer.',
    });
  }

  if (flags.includes("g")) {
    found.push({
      severity: "note",
      message:
        "With the g flag, re.test() and re.exec() remember lastIndex between calls - testing the same string twice can return true, then false. Use g only for finding all matches.",
    });
  }

  return found;
}
