import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { writeFile } from "../../utils/fsWrite.js";
import { isAvailable, runCommand } from "../../utils/runCommand.js";

/**
 * Creates the project base with NestJS's own CLI, then lets agbar overlay the
 * parts the CLI does not do.
 *
 * Why delegate instead of writing every file: `nest new` is maintained by the Nest
 * team, so its base always compiles and - crucially - its package.json carries a
 * dependency set they have already proven compatible. Hand-written version pins go
 * stale and conflict (this project hit TypeScript boxed between ts-jest's `<7` and
 * @nestjs/schematics' `>=6`, which only an install revealed). Letting the CLI
 * decide those versions removes that whole class of bug; agbar then adds only
 * the packages the CLI does not know about.
 *
 * Returns false rather than throwing when the CLI cannot be used (offline, npx
 * missing, a non-zero exit), so the adapter can fall back to writing the base
 * itself and still produce a working project.
 */
export async function bootstrapWithNestCli(parentDir: string, projectName: string, cliVersion: string): Promise<boolean> {
  if (!(await isAvailable("npx", parentDir))) return false;

  // --skip-install because the adapter installs once at the end, after the extra
  // dependencies have been merged in - installing twice would be wasted minutes.
  // --skip-git because scaffolding should not decide the user's VCS history.
  const result = await runCommand(
    "npx",
    ["--yes", `@nestjs/cli@${cliVersion}`, "new", projectName, "--skip-install", "--skip-git", "--package-manager", "npm", "--language", "TS"],
    parentDir,
    900_000
  );

  return result.ok && existsSync(path.join(parentDir, projectName, "package.json"));
}

/**
 * The files `nest new` writes that agbar replaces. Left in place they would be
 * duplicate, conflicting routes: the CLI's AppController serves GET / and its
 * AppModule declares providers this scaffold rewires into feature modules.
 */
const CLI_DEFAULTS_TO_REMOVE = [
  "src/app.controller.ts",
  "src/app.controller.spec.ts",
  "src/app.service.ts",
  // Rewritten with the same path by this adapter, but removed first so a rename
  // upstream cannot leave two e2e suites behind.
  "test/app.e2e-spec.ts",
];

export function removeCliDefaults(projectDir: string): void {
  for (const relPath of CLI_DEFAULTS_TO_REMOVE) {
    rmSync(path.join(projectDir, relPath), { force: true });
  }
}

/**
 * Adds agbar's extra dependencies and scripts to the CLI's package.json,
 * keeping whatever versions the CLI chose for everything it already listed.
 *
 * That ordering is the point: the Nest team's own pins win, and agbar only
 * fills gaps. An entry already present is never overwritten, so a future CLI that
 * ships @nestjs/config by default silently takes precedence over the pin here.
 */
export function mergePackageJson(
  projectDir: string,
  additions: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> }
): void {
  const manifestPath = path.join(projectDir, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;

  for (const section of ["dependencies", "devDependencies", "scripts"] as const) {
    const incoming = additions[section];
    if (!incoming) continue;
    const existing = (manifest[section] as Record<string, string> | undefined) ?? {};
    for (const [name, value] of Object.entries(incoming)) {
      // Scripts are ours to define (test:e2e, db:*); dependency versions are not,
      // when the CLI already has an opinion.
      if (section === "scripts" || existing[name] === undefined) existing[name] = value;
    }
    manifest[section] = Object.fromEntries(Object.entries(existing).sort(([a], [b]) => a.localeCompare(b)));
  }

  writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
