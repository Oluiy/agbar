/**
 * Dependency ranges for generated Express and Fastify projects, resolved against the
 * npm registry on 2026-10-02. Caret majors: npm resolves the newest compatible release
 * at install time, and the major is what the templates were written (and verified)
 * against.
 *
 * Kept current by Renovate (renovate.json): each `// renovate:` line names the npm
 * package the pin below it tracks. Every update arrives as a pull request, and
 * .github/workflows/scaffold-verify.yml generates, installs, typechecks, tests and builds
 * real projects against it before it can be merged. Majors held back on purpose (below)
 * are encoded as `allowedVersions` in renovate.json, so the bot will not propose them.
 *
 * Reasons that are not obvious - each was learned from a real install, not a doc:
 *
 *   - TypeScript is ^6, not `latest` (7.0.2). TypeScript 6 is the line Prisma 7's
 *     generated client was verified against; 7 is the native-compiler rewrite and was
 *     not exercised. Moving it is a decision, not a bump.
 *   - Prisma CLI, client and adapter share a major (7). The CLI's `latest` is an 8.x
 *     release candidate; a mixed set fails at `prisma generate`.
 *   - The Prisma adapters bundle their own driver (better-sqlite3 ^12 / pg). Do not list
 *     either here: a second copy at a different major installs two native builds.
 *   - Express is ^5. It changed behaviour that generated code relies on: rejected async
 *     handlers reach the error middleware without a wrapper, and `req.query` is a
 *     read-only getter (parse it, never assign it).
 */
export const NODE_VERSIONS = {
  // renovate: datasource=npm depName=express
  express: "^5.2.1",
  // renovate: datasource=npm depName=helmet
  helmet: "^8.3.0",
  // renovate: datasource=npm depName=express-rate-limit
  expressRateLimit: "^8.7.0",
  // renovate: datasource=npm depName=fastify
  fastify: "^5.12.5",
  // renovate: datasource=npm depName=@fastify/helmet
  fastifyHelmet: "^13.1.1",
  // renovate: datasource=npm depName=@fastify/rate-limit
  fastifyRateLimit: "^11.2.0",
  // renovate: datasource=npm depName=zod
  zod: "^4.6.5",
  // renovate: datasource=npm depName=prisma
  prisma: "^7.10.0",
  // renovate: datasource=npm depName=@prisma/adapter-better-sqlite3
  prismaAdapterSqlite: "^7.10.0",
  // renovate: datasource=npm depName=@prisma/adapter-pg
  prismaAdapterPg: "^7.10.0",
  // renovate: datasource=npm depName=dotenv
  dotenv: "^18.0.5",
  // Drizzle's `latest` is the stable 0.45 line; 1.0 is still a release candidate (rc.5), so
  // it is not used. drizzle-kit 0.31 is the CLI that pairs with it.
  // renovate: datasource=npm depName=drizzle-orm
  drizzleOrm: "^0.45.3",
  // renovate: datasource=npm depName=drizzle-kit
  drizzleKit: "^0.31.11",
  // Sequelize's `latest` is 6.37; v7 is still alpha (7.0.0-alpha.9), so it is not used.
  // sqlite3 is native (prebuilt via prebuild-install) and Sequelize 6's only SQLite driver.
  // renovate: datasource=npm depName=sequelize
  sequelize: "^6.37.8",
  // renovate: datasource=npm depName=umzug
  umzug: "^3.8.3",
  // renovate: datasource=npm depName=pg-hstore
  pgHstore: "^2.3.4",
  // renovate: datasource=npm depName=sqlite3
  sqlite3: "^6.0.1",
  // TypeORM 1.x. Entities use EntitySchema, not decorators (see orms/typeorm.ts for why).
  // renovate: datasource=npm depName=typeorm
  typeorm: "^1.1.1",
  // renovate: datasource=npm depName=pg
  pg: "^8.23.1",
  // renovate: datasource=npm depName=@types/pg
  typesPg: "^8.23.1",
  // ^12, the major Prisma's own SQLite adapter bundles and the one verified here. 13.x
  // exists but was NOT exercised: its tarball bundles prebuilt binaries (~22 MB), which
  // never finished downloading on the verification network. Moving to 13 is a decision,
  // to be made with a real install, not a bump.
  // renovate: datasource=npm depName=better-sqlite3
  betterSqlite3: "^12.6.0",
  // renovate: datasource=npm depName=@types/better-sqlite3
  typesBetterSqlite3: "^9.6.0",
  // renovate: datasource=npm depName=typescript
  typescript: "^6.0.3",
  // renovate: datasource=npm depName=tsx
  tsx: "^4.23.15",
  // renovate: datasource=npm depName=vitest
  vitest: "^5.0.3",
  // renovate: datasource=npm depName=supertest
  supertest: "^7.3.1",
  // renovate: datasource=npm depName=@types/express
  typesExpress: "^5.0.6",
  // renovate: datasource=npm depName=@types/supertest
  typesSupertest: "^7.2.1",
  // renovate: datasource=npm depName=@types/node
  typesNode: "^24.0.0",
  /** vitest 5 requires ^22.12 || ^24 || >=26, and --env-file-if-exists needs 22.9+. Not a package, so not tracked. */
  nodeEngine: "^22.12.0 || ^24.0.0 || >=26.0.0",
} as const;
