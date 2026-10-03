/** The shapes the FastAPI adapter's prompts, validation and generators all agree on. */

/**
 * How the Python package is laid out. All three produce the same running API -
 * the difference is where a new feature's code goes, which is the decision a
 * scaffold is actually making for you.
 */
export type FastApiStructure =
  // app/{api,services,repositories,models,schemas} - split by technical role.
  | "layered"
  // app/modules/<feature>/{router,service,repository,models,schemas} - split by
  // domain concept, so one feature is one folder.
  | "modular"
  // app/{domain,application,infrastructure,api} - the domain layer imports
  // nothing outward; infrastructure implements interfaces the domain declares.
  | "clean";

/** SQLite needs no server, so a generated project's tests pass immediately. */
export type FastApiDb = "sqlite" | "postgres" | "none";

export interface FastApiAddons {
  structure: FastApiStructure;
  db: FastApiDb;
  includeDocker: boolean;
  /** Run the package install and the test suite after generating, and report the result. */
  install: boolean;
}

export const FASTAPI_STRUCTURES: FastApiStructure[] = ["layered", "modular", "clean"];
export const FASTAPI_DBS: FastApiDb[] = ["sqlite", "postgres", "none"];
