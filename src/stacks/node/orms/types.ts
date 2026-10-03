import type { NodePaths } from "../layout.js";
import type { NodeDb, NodeOrm, NodeStructure } from "../types.js";

export interface OrmContext {
  projectName: string;
  db: NodeDb;
  structure: NodeStructure;
  paths: NodePaths;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

/**
 * Everything that differs between ORMs, in one place. The rest of the project - routes,
 * service, validation, config, tests, the server - talks only to the `Database` in
 * src/database.ts, so adding an ORM means writing one of these, not touching them.
 *
 * Each plug-in's `files()` includes src/db.ts, which exports `connect()`.
 */
export interface OrmPlugin {
  readonly id: Exclude<NodeOrm, "none">;
  readonly label: string;
  dependencies(db: NodeDb): Record<string, string>;
  devDependencies(db: NodeDb): Record<string, string>;
  scripts(db: NodeDb): Record<string, string>;
  /** Extra .gitignore lines, with a leading blank line and comment when non-empty. */
  readonly gitignore: string;
  files(ctx: OrmContext): GeneratedFile[];
  /** Import lines for test/global-setup.ts (the snippet below may use them). */
  readonly createSchemaImports: string;
  /**
   * TypeScript for the body of the async `setup()` in test/global-setup.ts, with `url` (a
   * string) in scope. It must create the schema in the TEST database, never DATABASE_URL,
   * and never reset or drop anything: a test run must not be able to destroy real data.
   */
  createSchemaSnippet(ctx: OrmContext): string;
  /** Lines for the generated Dockerfile's builder stage. Empty for ORMs with no codegen step. */
  docker: {
    buildEnv(db: NodeDb): string;
    copyBeforeInstall: string[];
    generateStep: string;
  };
  docs: {
    /** README: what to run after `npm install` to create the schema. */
    setupSteps(db: NodeDb): string;
    /** ARCHITECTURE.md: how to change the schema. */
    schemaChange: string;
    /** ARCHITECTURE.md: table rows (already formatted) for ORM-specific decisions. */
    decisions: string;
    /** ARCHITECTURE.md: the one-line "where does SQL live" claim. */
    sqlLives: string;
  };
}
