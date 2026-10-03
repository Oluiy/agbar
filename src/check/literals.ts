/**
 * Blanks every string literal and comment to spaces, keeping newlines - so the
 * result has the same length and the same line numbers as the input.
 *
 * Why: rules looking for *code* (a fetch call, a server being built, a DB call)
 * kept matching *text about code*. Running `check` on Idari - a code analyzer -
 * produced 5 findings and all 5 were false: `"axios.get"` in a lookup table,
 * `"var b = WebApplication.CreateBuilder(args);"` in a test fixture. Any code
 * generator, linter, or docs-heavy repo hits the same wall.
 *
 * Not a parser: a small per-language scanner. Where a language construct could
 * derail it (a quote inside a JS regex literal, a Rust char literal like '"'),
 * single-line strings stop at the end of the line, so the damage is one line.
 */

interface Syntax {
  lineComments: string[];
  blockComments: boolean;
  /** Single-line quote characters, with backslash escapes. */
  quotes: string;
  /** `"""` / `'''` strings (Python, Java text blocks, Kotlin). */
  triple: boolean;
  /** Backtick strings: JS templates (escapes) or Go raw strings (none). Both span lines. */
  backtick?: "escapes" | "raw";
  /**
   * JS regex literals. Without this, a quote or backtick inside one (/["'`]/)
   * opened a "string" that swallowed the real code after it - a fetch with no
   * timeout two lines below `const re = /[`]/;` went unreported.
   */
  regexLiterals?: boolean;
  /** Rust raw strings: r"..." and r#"..."#. */
  rustRaw?: boolean;
  /**
   * C#: raw strings (`"""` or longer, closed by the same run - `$$"""` templates
   * included) and verbatim `@"..."` strings, which span lines and escape `"` as `""`.
   * Missing these let BuildQuickPkg's generated-code templates count as its own code.
   */
  csharp?: boolean;
}

const C_LIKE: Syntax = { lineComments: ["//"], blockComments: true, quotes: `"'`, triple: false };
const JS: Syntax = { ...C_LIKE, backtick: "escapes", regexLiterals: true };

/**
 * A `/` starts a regex (not a division) when what precedes it can't end a value:
 * an operator, an opening bracket, a comma, a keyword like `return`, or nothing.
 */
function startsRegex(src: string, i: number): boolean {
  let j = i - 1;
  while (j >= 0 && (src[j] === " " || src[j] === "\t")) j--;
  if (j < 0 || src[j] === "\n") return true;
  if ("(,=:[!&|?{};+-*%<>~^".includes(src[j])) return true;
  return /\b(return|typeof|case|in|of|new|delete|void|throw|yield|await)$/.test(src.slice(Math.max(0, j - 7), j + 1));
}

/** End index (exclusive) of a regex literal starting at `i`, or -1 if it isn't one (no closing / on this line). */
function regexEnd(src: string, i: number): number {
  let inClass = false;
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === "\n") return -1;
    if (c === "\\") {
      j++;
      continue;
    }
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) {
      let k = j + 1;
      while (k < src.length && /[a-z]/i.test(src[k])) k++; // flags
      return k;
    }
  }
  return -1;
}

const SYNTAX: Record<string, Syntax> = {
  ".ts": JS,
  ".tsx": JS,
  ".js": JS,
  ".jsx": JS,
  ".mjs": JS,
  ".cjs": JS,
  ".java": { ...C_LIKE, triple: true },
  ".kt": { ...C_LIKE, triple: true },
  ".cs": { ...C_LIKE, csharp: true },
  // Go: '…' is a rune, backticks are raw multi-line strings.
  ".go": { ...C_LIKE, backtick: "raw" },
  // Rust: ' is a lifetime far more often than a char, so it is not a quote here.
  ".rs": { lineComments: ["//"], blockComments: true, quotes: `"`, triple: false, rustRaw: true },
  ".py": { lineComments: ["#"], blockComments: false, quotes: `"'`, triple: true },
  ".rb": { lineComments: ["#"], blockComments: false, quotes: `"'`, triple: false },
  ".php": { lineComments: ["//", "#"], blockComments: true, quotes: `"'`, triple: false },
};

export function blankLiterals(src: string, ext: string): string {
  const syntax = SYNTAX[ext];
  if (!syntax) return src;

  const out = src.split("");
  const n = src.length;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  /** Blank [start, index of `close` + its length), or to the end if unclosed. Returns the new position. */
  const blankUntil = (start: number, searchFrom: number, close: string): number => {
    const end = src.indexOf(close, searchFrom);
    const stop = end === -1 ? n : end + close.length;
    blank(start, stop);
    return stop;
  };

  let i = 0;
  while (i < n) {
    const ch = src[i];

    if (syntax.lineComments.some((lc) => src.startsWith(lc, i))) {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (syntax.blockComments && src.startsWith("/*", i)) {
      i = blankUntil(i, i + 2, "*/");
      continue;
    }
    if (syntax.regexLiterals && ch === "/" && src[i + 1] !== "/" && src[i + 1] !== "*" && startsRegex(src, i)) {
      const end = regexEnd(src, i);
      if (end !== -1) {
        blank(i, end);
        i = end;
        continue;
      }
    }
    if (syntax.rustRaw && ch === "r" && !/\w/.test(src[i - 1] ?? "")) {
      const hashes = /^r(#*)"/.exec(src.slice(i, i + 12))?.[1];
      if (hashes !== undefined) {
        i = blankUntil(i, i + 2 + hashes.length, `"${hashes}`);
        continue;
      }
    }
    if (syntax.csharp && src.startsWith('"""', i)) {
      const run = /^"+/.exec(src.slice(i))![0];
      i = blankUntil(i, i + run.length, run);
      continue;
    }
    if (syntax.csharp && src.startsWith('@"', i)) {
      let j = i + 2;
      while (j < n && !(src[j] === '"' && src[j + 1] !== '"')) j += src[j] === '"' ? 2 : 1;
      const stop = Math.min(n, j + 1);
      blank(i, stop);
      i = stop;
      continue;
    }
    if (syntax.triple && (src.startsWith('"""', i) || src.startsWith("'''", i))) {
      i = blankUntil(i, i + 3, src.slice(i, i + 3));
      continue;
    }
    if (ch === "`" && syntax.backtick) {
      let j = i + 1;
      while (j < n && src[j] !== "`") j += syntax.backtick === "escapes" && src[j] === "\\" ? 2 : 1;
      const stop = Math.min(n, j + 1);
      blank(i, stop);
      i = stop;
      continue;
    }
    if (syntax.quotes.includes(ch)) {
      let j = i + 1;
      while (j < n && src[j] !== ch && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      const stop = src[j] === ch ? j + 1 : Math.min(j, n);
      blank(i, stop);
      i = stop;
      continue;
    }
    i++;
  }
  return out.join("");
}
