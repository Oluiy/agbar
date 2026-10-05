import * as clack from "@clack/prompts";
import pc from "picocolors";
import type { ScaffoldConfig } from "./config.js";
import type { StackAdapter } from "./stacks/StackAdapter.js";
import type { VerifyResult } from "./stacks/verifyResult.js";

/** The commands to finish the job by hand, as a copy-pasteable block. */
export function printNextSteps(config: ScaffoldConfig, adapter: StackAdapter): void {
  const steps = adapter.nextSteps?.(config);
  if (!steps?.length) return;
  clack.log.info(`Next:\n${steps.map((s) => `  ${pc.cyan(s)}`).join("\n")}`);
}

/**
 * Reports whether the generated project actually installed and passed its tests.
 * Worth printing loudly either way: "it generated" and "it works" are different
 * claims, and only one of them is worth trusting.
 */
export function printVerifyResult(result: VerifyResult | undefined, config: ScaffoldConfig, adapter: StackAdapter): void {
  if (!result) {
    // Nothing was installed (the fast default), so say how to finish rather than imply it works.
    printNextSteps(config, adapter);
    return;
  }

  if (result.cancelled) {
    clack.log.warn("Install cancelled. The project is intact - finish it yourself:");
    printNextSteps(config, adapter);
    return;
  }
  if (result.installed === undefined) {
    clack.log.warn(`Not verified: ${result.detail}`);
    return;
  }
  if (!result.installed) {
    clack.log.error(`Dependency install failed (${result.via}). The files are written; fix the install and re-run the tests.\n${result.detail}`);
    return;
  }
  if (result.testsPassed) {
    clack.log.success(pc.green(`Verified: dependencies installed (${result.via}) and the test suite passes.`));
    return;
  }
  clack.log.error(`Installed (${result.via}), but the tests did not pass:\n${result.detail}`);
}
