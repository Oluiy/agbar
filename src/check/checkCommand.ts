import path from "node:path";
import pc from "picocolors";
import { buildGapReport, buildMailto, isUnrecognizedStack, openInBrowser, writeGapReportFile } from "./reportGap.js";
import { renderCheckReport, renderFixPlan } from "./reportRender.js";
import { scanRepo } from "./repo.js";
import { RULES } from "./rules.js";
import { runCheck } from "./runner.js";

export interface CheckOptions {
  explain: boolean;
  fixPlan: boolean;
  json: boolean;
  reportGap?: number | true; // true means "the unrecognized-stack case," a number means "this finding"
  note?: string;
  includeEvidence: boolean;
}

/** CLI glue only: scan, run, pick a renderer. All formatting lives in reportRender.ts. */
export function printCheck(targetPath: string, opts: CheckOptions): void {
  const root = path.resolve(targetPath);
  let repo;
  try {
    repo = scanRepo(root);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (opts.json) console.log(JSON.stringify({ error: message }, null, 2));
    else console.error(pc.red(message));
    process.exitCode = 1;
    return;
  }

  if (repo.allPaths.length === 0) {
    if (opts.json) console.log(JSON.stringify({ root, empty: true, passed: [], skipped: [], findings: [] }, null, 2));
    else console.log(pc.dim(`\n${root} looks empty - nothing to check.`));
    return;
  }

  const report = runCheck(repo);

  if (opts.reportGap !== undefined) {
    const findingIndex = typeof opts.reportGap === "number" ? opts.reportGap : undefined;
    const gap = buildGapReport(repo, report, findingIndex, opts.note, opts.includeEvidence);
    if ("error" in gap) {
      console.error(pc.red(gap.error));
      process.exitCode = 1;
      return;
    }
    const file = writeGapReportFile(gap);
    console.log(pc.dim(`Wrote ${file}`));
    openInBrowser(buildMailto(gap));
    console.log(pc.bold("Opened your mail client with the report pre-filled - nothing sends until you do."));
    return;
  }

  if (opts.json) {
    // One JSON object, nothing else - no color codes or narrative lines mixed
    // in, so it's reliably parseable (the fixture suite depends on this).
    // stackRecognized is a boolean, not a detected-stack list: the appliesTo()
    // checks already scattered across the rules ARE the stack detection: a
    // parallel detectStack.ts would just be a second, driftable copy of it.
    console.log(
      JSON.stringify(
        { root, stackRecognized: !isUnrecognizedStack(repo, report), passed: report.passed, skipped: report.skipped, findings: report.findings },
        null,
        2
      )
    );
    return;
  }

  console.log(opts.fixPlan ? renderFixPlan(report, opts.explain) : renderCheckReport(report, root, opts.explain));

  if (isUnrecognizedStack(repo, report)) {
    console.log(pc.yellow("\nagbar didn't recognize this stack well enough to run its usual checks."));
    console.log(pc.dim("Run 'agbar check --report-gap' to send that as a gap report - no code leaves your machine unless you do."));
  }
}

/** Exported for the test that every rule points at a concept that exists. */
export const ALL_RULES = RULES;
