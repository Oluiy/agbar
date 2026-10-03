import { isAvailable, runCommand } from "../../utils/runCommand.js";
import { tail } from "../../utils/text.js";
import type { VerifyResult } from "../verifyResult.js";

/**
 * Builds the generated crate and runs its tests with cargo itself.
 *
 * The first build compiles every dependency (sqlx bundles SQLite's C source), which
 * takes minutes on a cold cache - hence the long timeout. A compile error here is the
 * most valuable signal this adapter has: a template that does not type-check is a
 * broken project, whatever the file tree looks like.
 *
 * Never throws: generation already succeeded, so a failure is something to report.
 */
export async function installAndTest(projectDir: string): Promise<VerifyResult> {
  if (!(await isAvailable("cargo", projectDir))) {
    return { detail: "cargo is not on PATH, so the project could not be verified here." };
  }

  const tests = await runCommand("cargo", ["test", "--quiet"], projectDir, 1_800_000);
  const output = `${tests.stdout}\n${tests.stderr}`;

  // A failed *build* and a failed *test* are different problems, and the user should
  // be told which.
  if (!tests.ok && /error(\[E\d+\])?:/.test(output) && !/test result:/.test(output)) {
    return { installed: false, via: "cargo", detail: tail(tests.stderr || tests.stdout) };
  }
  return { installed: true, testsPassed: tests.ok, via: "cargo", detail: tail(tests.stdout || tests.stderr) };
}
