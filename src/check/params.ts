/**
 * The parameters of a constructor or function, split at TOP-LEVEL commas only.
 *
 * The old rule sliced from the first "(" to the first ")" and split on every
 * comma, which is wrong in both directions: `Dictionary<string, decimal>` and
 * `Func<int, string>` counted as two parameters each (inflating), while Go's
 * `f func(int, int) error` ended the list at its own ")" (truncating). Brackets
 * of every kind are tracked, and `->` / `=>` are not mistaken for a closing `>`.
 *
 * Returns undefined when the parentheses never balance within the text given -
 * the caller skips it, because a wrong count is worse than no count.
 */
export function topLevelParams(text: string, openIndex: number): string[] | undefined {
  let depth = 0;
  let current = "";
  const parts: string[] = [];

  for (let i = openIndex; i < text.length; i++) {
    const c = text[i];
    const prev = text[i - 1];
    if (c === "(" || c === "[" || c === "{" || c === "<") {
      depth++;
      if (depth === 1) continue; // the list's own opening paren
    } else if (c === ")" || c === "]" || c === "}" || (c === ">" && prev !== "-" && prev !== "=")) {
      depth--;
      if (depth === 0) {
        parts.push(current);
        return parts.map((p) => p.trim()).filter((p) => p !== "");
      }
    } else if (c === "," && depth === 1) {
      parts.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  return undefined;
}

/** Joins lines forward from `start` until the first "(" on that line has its match, up to `maxLines`. */
export function parametersAt(lines: string[], start: number, maxLines = 15): string[] | undefined {
  let text = "";
  for (let j = start; j < Math.min(start + maxLines, lines.length); j++) {
    text += `${lines[j]}\n`;
    const open = text.indexOf("(");
    if (open === -1) continue;
    const params = topLevelParams(text, open);
    if (params) return params;
  }
  return undefined;
}
