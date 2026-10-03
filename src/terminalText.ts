import pc from "picocolors";
import { attention, bad, dim, good, name } from "./ui/palette.js";

/**
 * Lesson and concept text is written with light markdown - **key point** and
 * `code` - and used to be printed as-is, so the terminal showed literal
 * asterisks and backticks and the emphasis the author wrote never landed.
 *
 * Colour is meaning, the same everywhere in buildquick: bold yellow = the point
 * to remember, cyan = code / something you type, red = the failure, green = the
 * fix, dim = asides. When colour is off (piped output, NO_COLOR), the text is
 * returned unchanged, so the markers still carry the emphasis.
 */
export function emphasize(text: string): string {
  if (!pc.isColorSupported) return text;
  return text.replace(/\*\*([^*\n]+)\*\*/g, (_, s: string) => attention(s)).replace(/`([^`\n]+)`/g, (_, s: string) => name(s));
}

/**
 * A code sample, coloured by what each line is for: comments dim, lines that
 * say "bad" red, lines that say "good" green - so the contrast in a bad/good
 * example is visible before a word of it is read.
 */
export function codeBlock(code: string, indent = "  "): string {
  return code
    .trimEnd()
    .split("\n")
    .map((line) => {
      const tone = /\bbad\b/i.test(line) ? bad : /\bgood\b/i.test(line) ? good : /^\s*(\/\/|#|--)/.test(line) ? dim : (s: string) => s;
      return `${indent}${tone(line)}`;
    })
    .join("\n");
}
