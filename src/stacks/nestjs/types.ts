/** The shapes the NestJS adapter's prompts, validation and generators all agree on. */

/**
 * NestJS is modular by construction, so the choice is not "do we have modules"
 * but how much separation lives inside one.
 */
export type NestStructure =
  // src/modules/<feature>/{controller,service,repository,dto} - the Nest default,
  // and what most Nest codebases look like.
  | "modular"
  // Adds a layer boundary inside each feature: domain/ (entities + a repository
  // port), application/ (use cases), infrastructure/ (the Prisma implementation).
  | "clean";

export type NestOrm = "prisma" | "typeorm" | "none";
export type NestDb = "sqlite" | "postgres";

/**
 * TypeORM is a declared type but not yet a generatable option: the feature
 * templates are Prisma-shaped. It is rejected by name in resolveNestAddons rather
 * than quietly generating a project whose imports do not resolve.
 */
export const NEST_ORMS_IMPLEMENTED: NestOrm[] = ["prisma", "none"];

export interface NestAddons {
  structure: NestStructure;
  orm: NestOrm;
  db: NestDb;
  includeDocker: boolean;
  /**
   * Create the base with `nest new` (the framework's own CLI) and overlay on top,
   * instead of writing every file here. Preferred, because the Nest team's
   * package.json is a dependency set they have already proven compatible. Falls
   * back automatically when npx is unavailable or the CLI exits non-zero.
   */
  useCli: boolean;
  /** Run the install and the test suite after generating, and report the result. */
  install: boolean;
}

export const NEST_STRUCTURES: NestStructure[] = ["modular", "clean"];
export const NEST_ORMS: NestOrm[] = ["prisma", "typeorm", "none"];

export const NEST_DBS: NestDb[] = ["sqlite", "postgres"];
