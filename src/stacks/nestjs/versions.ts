/**
 * Dependency versions, resolved against the npm registry on 2026-10-02 and chosen
 * for compatibility rather than for being newest.
 *
 * Kept current by Renovate (renovate.json): each `// renovate:` line names the npm
 * package the pin below it tracks. Every update arrives as a pull request, and
 * .github/workflows/scaffold-verify.yml generates, installs, typechecks, tests and builds
 * real projects against it before it can be merged. Majors held back on purpose (below)
 * are encoded as `allowedVersions` in renovate.json, so the bot will not propose them.
 *
 * Why this file exists at all: npm ranges in a template rot, and "just use latest"
 * generates broken projects. Two live examples, both verified rather than assumed:
 *
 *   - TypeScript is boxed in from both sides: ts-jest declares
 *     `typescript: ">=4.3 <7"` and @nestjs/schematics declares `">=6.0.0"`. Only
 *     6.x satisfies both, so `latest` (7.0.2) and the previous line (5.9.3) each
 *     fail `npm install` with ERESOLVE. Verified by installing, not by reading.
 *   - The Prisma CLI's `latest` is an 8.x release candidate while
 *     `@prisma/client` is 7.10.0. The two must share a major, so both are pinned
 *     to 7 - a mismatched pair fails at `prisma generate`.
 *
 * Caret ranges, so patches and minors arrive on install; the lock file the project
 * commits is what makes a build reproducible. Re-check these when a generated
 * project stops installing cleanly, and update the compatibility notes above with it.
 */
export const NEST_VERSIONS = {
  // One pin for @nestjs/core, /common, /platform-express and /testing, which release together.
  // renovate: datasource=npm depName=@nestjs/core
  nest: "^12.1.2",
  // renovate: datasource=npm depName=@nestjs/config
  nestConfig: "^12.0.1",
  /**
   * A devDependency, exactly as `nest new` would leave it. The CLI is how a Nest
   * project is idiomatically built and extended: `nest g resource x` writes the
   * files *and* updates the neighbouring module's imports, `nest start --watch`
   * gives live reload, and `nest build` can switch between tsc, swc and rspack.
   * Generating a project without it would save install time and cost the user
   * every one of those.
   */
  // renovate: datasource=npm depName=@nestjs/cli
  nestCli: "^12.0.8",
  // renovate: datasource=npm depName=@nestjs/schematics
  nestSchematics: "^12.0.6",
  // renovate: datasource=npm depName=@nestjs/throttler
  nestThrottler: "^6.7.1",
  // renovate: datasource=npm depName=rxjs
  rxjs: "^7.8.2",
  // renovate: datasource=npm depName=reflect-metadata
  reflectMetadata: "^0.2.2",
  /**
   * NOT 0.15.1 (the current `latest`): that release declares
   * `typings: "./types/index.d.ts"` but ships no `types/` directory, so every
   * import of it becomes an implicit `any` and fails under `strict`. An upstream
   * packaging bug, caught only by compiling a generated project. 0.14.4 ships its
   * declarations correctly.
   */
  // renovate: datasource=npm depName=class-validator
  classValidator: "^0.14.4",
  // renovate: datasource=npm depName=class-transformer
  classTransformer: "^0.5.1",
  // Below 7: ts-jest's peer range is ">=4.3 <7".
  // renovate: datasource=npm depName=typescript
  typescript: "^6.0.3",
  // renovate: datasource=npm depName=jest
  jest: "^30.5.2",
  // renovate: datasource=npm depName=ts-jest
  tsJest: "^29.4.14",
  // renovate: datasource=npm depName=@types/jest
  typesJest: "^30.0.0",
  // renovate: datasource=npm depName=@types/node
  typesNode: "^26.6.4",
  // renovate: datasource=npm depName=@types/supertest
  typesSupertest: "^7.2.1",
  // @nestjs/platform-express does not bring Express's types with it, and the
  // health controller imports its Response type.
  // renovate: datasource=npm depName=@types/express
  typesExpress: "^5.0.6",
  // renovate: datasource=npm depName=supertest
  supertest: "^7.3.0",
  // Client, CLI and driver adapters must all share a major; 7 is the current stable set.
  // Prisma 7 removed `url` from schema.prisma and requires a driver adapter passed to
  // PrismaClient, so the adapter is a hard dependency, not an option.
  // renovate: datasource=npm depName=prisma
  prisma: "^7.10.0",
  // Each adapter bundles its own database driver (better-sqlite3 ^12 / pg + @types/pg).
  // Do NOT also list better-sqlite3 or pg here: a second copy at a different major
  // installs two native builds.
  // renovate: datasource=npm depName=@prisma/adapter-better-sqlite3
  prismaAdapterSqlite: "^7.10.0",
  // renovate: datasource=npm depName=@prisma/adapter-pg
  prismaAdapterPg: "^7.10.0",
  // Imported by prisma.config.ts so DATABASE_URL in .env reaches the Prisma CLI.
  // renovate: datasource=npm depName=dotenv
  dotenv: "^18.0.5",
  // NestJS 12's @nestjs/schematics and Angular devkit require this (verified from npm
  // engines); older Node installs with EBADENGINE warnings and may fail at run time.
  // Not a package, so not tracked.
  nodeEngine: "^22.22.3 || ^24.15.0 || >=26.0.0",
  // The four below back the TypeORM option, which this adapter does not generate yet.
  // renovate: datasource=npm depName=typeorm
  typeorm: "^1.1.1",
  // renovate: datasource=npm depName=@nestjs/typeorm
  nestTypeorm: "^12.0.2",
  // renovate: datasource=npm depName=pg
  pg: "^8.23.1",
  // ^12 to match the verified major (see node/versions.ts); 13 is untested.
  // renovate: datasource=npm depName=better-sqlite3
  betterSqlite3: "^12.6.0",
  // renovate: datasource=npm depName=@types/better-sqlite3
  typesBetterSqlite3: "^9.6.0",
} as const;
