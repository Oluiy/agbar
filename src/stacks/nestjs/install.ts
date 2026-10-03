import { isAvailable, runCommand } from "../../utils/runCommand.js";
import type { VerifyResult } from "../verifyResult.js";
import { tail } from "../../utils/text.js";
import type { NestOrm } from "./types.js";

/**
 * Installs the generated project and runs its tests.
 *
 * This is what makes "a working project" a fact rather than a claim: the file tree
 * can look perfect while the TypeScript does not compile. Only `npm test` is run
 * (unit tests plus the health check) because it needs no database; the e2e suite
 * resets a real schema and is left for the developer to run.
 *
 * Never throws - generation already succeeded, so a failure here is something to
 * report, not a reason to discard the files.
 */
export async function installAndTest(projectDir: string, orm: NestOrm): Promise<VerifyResult> {
  if (!(await isAvailable("npm", projectDir))) {
    return { detail: "npm is not on PATH, so the project could not be verified here." };
  }

  // No lock file exists yet, so `npm ci` cannot be used - that is the one case
  // where `npm install` is the correct command.
  const install = await runCommand("npm", ["install", "--no-audit", "--no-fund"], projectDir, 900_000);
  if (!install.ok) {
    return { installed: false, via: "npm", detail: tail(install.stderr || install.stdout) };
  }

  if (orm === "prisma") {
    // package.json runs this on postinstall too; running it explicitly means a
    // generation failure is reported as itself rather than as a compile error later.
    const generate = await runCommand("npx", ["prisma", "generate"], projectDir, 300_000);
    if (!generate.ok) {
      return { installed: true, testsPassed: false, via: "npm", detail: `prisma generate failed:\n${tail(generate.stderr || generate.stdout)}` };
    }
  }

  const tests = await runCommand("npm", ["test", "--silent"], projectDir, 600_000);
  return { installed: true, testsPassed: tests.ok, via: "npm", detail: tail(tests.stdout || tests.stderr) };
}
