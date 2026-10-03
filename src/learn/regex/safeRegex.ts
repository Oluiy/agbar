import vm from "node:vm";

/**
 * Running a learner's (or user's) regex safely. A pattern like ^(a+)+$ against
 * "aaaa...a!" backtracks exponentially and can freeze for minutes - which is
 * exactly what a lesson on catastrophic backtracking has to demonstrate. Running
 * it inside a vm with a timeout interrupts the regex engine itself, verified:
 * ^(a+)+$ on 32 a's + "!" is stopped at ~200ms instead of hanging the CLI.
 */

export const REGEX_TIMEOUT_MS = 200;

export class RegexTimeout extends Error {}

/** `/source/flags` or a bare source. Throws SyntaxError (with the engine's message) if it doesn't compile. */
export function parsePattern(text: string, defaultFlags = ""): RegExp {
  const literal = /^\/(.*)\/([a-z]*)$/s.exec(text.trim());
  return literal ? new RegExp(literal[1], literal[2]) : new RegExp(text.trim(), defaultFlags);
}

function run<T>(code: string, context: Record<string, unknown>): T {
  try {
    return vm.runInNewContext(code, context, { timeout: REGEX_TIMEOUT_MS }) as T;
  } catch (err) {
    if ((err as { code?: string }).code === "ERR_SCRIPT_EXECUTION_TIMEOUT") throw new RegexTimeout();
    throw err;
  }
}

/** First match (like re.exec without g), or null. A fresh copy is used, so a `g` flag's lastIndex never leaks between calls. */
export function safeExec(re: RegExp, input: string): RegExpExecArray | null {
  const fresh = new RegExp(re.source, re.flags.replace("g", "").replace("y", ""));
  return run<RegExpExecArray | null>("re.exec(s)", { re: fresh, s: input });
}

/** Every match with its position - for highlighting. Empty matches advance by one so this can't loop. */
export function safeMatchAll(re: RegExp, input: string): { index: number; text: string; groups: (string | undefined)[] }[] {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const all = run<RegExpExecArray[]>("[...s.matchAll(re)]", { re: new RegExp(re.source, flags), s: input });
  return all.map((m) => ({ index: m.index ?? 0, text: m[0], groups: m.slice(1) }));
}
