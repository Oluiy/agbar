import { isAvailable } from "../../utils/runCommand.js";
import { tail } from "../../utils/text.js";
import type { RunContext } from "../StackAdapter.js";
import { stepRunner } from "../stepRunner.js";
import type { VerifyResult } from "../verifyResult.js";

/**
 * Installs the generated project and runs its tests with npm itself.
 *
 * `npm install` runs the Prisma `postinstall` (generating the client), then `npm test`
 * runs vitest. A compile or install failure here is the most valuable signal this adapter
 * has: a template that does not work is a broken project, whatever the file tree looks
 * like.
 *
 * Fetch timeouts are set explicitly. Without them npm, Maven and curl each sat silent on a
 * stalled connection until the caller gave up, then finished in seconds once a stall
 * timeout aborted and retried the transfer.
 *
 * Never throws: generation already succeeded, so a failure is something to report.
 */
export async function installAndTest(projectDir: string, context: RunContext): Promise<VerifyResult> {
  const run = stepRunner(context, projectDir);
  if (!(await isAvailable("npm", projectDir))) {
    return { detail: "npm is not on PATH, so the project could not be verified here." };
  }

  const install = await run(
    "installing packages with npm",
    "npm",
    ["install", "--no-audit", "--no-fund", "--fetch-timeout=30000", "--fetch-retries=8", "--fetch-retry-mintimeout=1000", "--fetch-retry-maxtimeout=15000"],
    { timeoutMs: 1_200_000 }
  );
  if (!install.ok) {
    return { installed: false, via: "npm", detail: tail(install.stderr || install.stdout) };
  }

  const tests = await run("running the tests", "npm", ["test", "--silent"], { timeoutMs: 600_000 });
  return { installed: true, testsPassed: tests.ok, via: "npm", detail: tail(tests.stdout || tests.stderr) };
}
