/** The shapes the Express/Fastify adapters' prompts, validation and generators agree on. */

export type NodeFramework = "express" | "fastify";

/** Both produce the same API; they differ in where code lives and which way dependencies point. */
export type NodeStructure =
  // src/items/{entity,repository,service,schemas,http}.ts - one feature folder.
  | "layered"
  // domain/ (plain types + the repository interface), application/ (service),
  // infrastructure/ (the Prisma implementation), api/ (schemas + HTTP). domain/
  // imports nothing from Prisma, zod or the web framework.
  | "clean";

export type NodeOrm = "prisma" | "drizzle" | "typeorm" | "sequelize" | "none";
export type NodeDb = "sqlite" | "postgres";

export interface NodeAddons {
  structure: NodeStructure;
  orm: NodeOrm;
  db: NodeDb;
  includeDocker: boolean;
  /** Run npm install and the test suite after generating, and report the result. */
  install: boolean;
}

export const NODE_STRUCTURES: NodeStructure[] = ["layered", "clean"];
/**
 * Every ORM we know the name of. Which of them can actually be generated is decided by
 * the plug-in registry (orms/index.ts), so an ORM not yet built is rejected *by name*
 * with an honest message instead of being "unknown option" or quietly generating a
 * project whose imports do not resolve.
 */
export const NODE_ORMS: NodeOrm[] = ["prisma", "drizzle", "typeorm", "sequelize", "none"];
export const NODE_DBS: NodeDb[] = ["sqlite", "postgres"];
