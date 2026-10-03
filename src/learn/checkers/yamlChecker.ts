import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import { writeFile } from "../../utils/fsWrite.js";
import { failureOf } from "../yamlAssertions.js";
import type { Challenge, CheckResult, Checker } from "../types.js";

/**
 * Grades YAML - GitHub Actions workflows, cron schedules, config files - by what
 * the file *means* once parsed, never by how it's spelled. Runs in-process with
 * the `yaml` package buildquick already ships, so there is nothing to spawn and
 * nothing to install.
 */

/**
 * The parser's error codes, translated into what actually went wrong. A raw
 * "BAD_ALIAS" teaches nothing; knowing that `*` starts an alias is the lesson.
 */
const EXPLAIN: Record<string, string> = {
  TAB_AS_INDENT: "YAML forbids tabs for indentation - use spaces (2 is the convention).",
  DUPLICATE_KEY: "The same key appears twice in one map. YAML parsers disagree on which wins, so it's an error, not a merge.",
  BAD_ALIAS: 'A value starting with `*` is read as an alias (a reference to an `&anchor`). Quote it: cron expressions like "*/5 * * * *" always need quotes.',
  BAD_INDENT: "Indentation is structure in YAML: a child must be indented further than its parent, and siblings exactly the same.",
  MISSING_CHAR: "Something is unclosed - usually a quote or a bracket.",
  BLOCK_AS_IMPLICIT_KEY: "A `key: value` line is probably mis-indented, so the parser read it as part of the line above.",
};

/**
 * The same mistake arrives under different codes depending on where it sits:
 * `c: * * *` is BAD_ALIAS, but an unquoted every-5-minutes cron inside a list is a generic
 * UNEXPECTED_TOKEN whose message mentions the alias. Match the message too, or
 * the most common cron mistake gets the least helpful explanation.
 */
function explain(code: string, message: string): string {
  if (EXPLAIN[code]) return EXPLAIN[code];
  if (/alias/i.test(message)) return EXPLAIN.BAD_ALIAS;
  return message.split("\n")[0];
}

export const yamlChecker: Checker = {
  solutionPath(workspaceDir: string): string {
    return path.join(workspaceDir, "solution.yml");
  },

  scaffold(challenge: Challenge, workspaceDir: string): void {
    const solution = this.solutionPath(workspaceDir, challenge);
    if (!existsSync(solution)) {
      writeFile(solution, challenge.starterCode);
    }
  },

  async run(challenge: Challenge, workspaceDir: string): Promise<CheckResult> {
    if (challenge.checkType !== "yaml_assertions" || !challenge.assertions?.length) {
      return { passed: false, message: `The YAML checker needs check_type 'yaml_assertions' with at least one assertion (challenge '${challenge.id}').` };
    }

    const source = readFileSync(this.solutionPath(workspaceDir, challenge), "utf-8");
    const doc = parseDocument(source, { prettyErrors: true });
    if (doc.errors.length > 0) {
      const first = doc.errors[0];
      const line = first.linePos?.[0]?.line;
      const why = explain(first.code, first.message);
      return { passed: false, message: `Not valid YAML${line ? ` (line ${line})` : ""}: ${why}` };
    }

    let parsed: unknown;
    try {
      parsed = doc.toJS();
    } catch (err) {
      // `x: *abc` parses cleanly - it's valid alias syntax - and only throws here,
      // when there's no `&abc` anchor to resolve. It must never crash the CLI.
      return { passed: false, message: `Couldn't read the file's values: ${explain("", (err as Error).message)}` };
    }

    const failures = challenge.assertions.flatMap((a) => {
      const why = failureOf(parsed, a);
      return why ? [`${a.message}\n    (${why})`] : [];
    });
    return failures.length === 0
      ? { passed: true, message: `All ${challenge.assertions.length} checks pass.` }
      : { passed: false, message: failures.map((f) => `- ${f}`).join("\n") };
  },
};
