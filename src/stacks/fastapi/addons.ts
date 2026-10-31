import { confirm, select } from "@clack/prompts";
import { checkCancel } from "../../utils/prompts.js";
import { FASTAPI_DBS, FASTAPI_STRUCTURES, type FastApiAddons, type FastApiDb, type FastApiStructure } from "./types.js";

/**
 * The input half of the FastAPI adapter: the interactive prompts, and the
 * validation of the same choices when they arrive as flags or a config file.
 */

export async function promptFastApiAddons(): Promise<Record<string, unknown>> {
  const structure = checkCancel<FastApiStructure>(
    await select({
      message: "Project structure:",
      options: [
        { value: "layered", label: "Layered (api / services / repositories - the common default)" },
        { value: "modular", label: "Modular by feature (one folder per domain concept)" },
        { value: "clean", label: "Clean / hexagonal (domain, application, infrastructure)" },
      ],
    })
  );

  const db = checkCancel<FastApiDb>(
    await select({
      message: "Database (SQLAlchemy 2.x + Alembic):",
      options: [
        { value: "sqlite", label: "SQLite (no server needed - tests pass immediately)" },
        { value: "postgres", label: "PostgreSQL (psycopg; docker-compose provided)" },
        { value: "none", label: "None (routes only)" },
      ],
    })
  );

  const includeDocker = checkCancel(await confirm({ message: "Add Dockerfile & docker-compose.yml?", initialValue: db === "postgres" }));
  const install = checkCancel(await confirm({ message: "Install dependencies and run the tests now? (takes minutes)", initialValue: false }));

  return { structure, db, includeDocker, install } satisfies FastApiAddons;
}

/** Non-interactive equivalent: validates raw flag/config input and fills defaults, throwing on anything invalid rather than silently generating the wrong thing. */
export function resolveFastApiAddons(raw: Record<string, unknown>): Record<string, unknown> {
  const structure = (raw.structure as string | undefined) ?? "layered";
  if (!FASTAPI_STRUCTURES.includes(structure as FastApiStructure)) {
    throw new Error(`Invalid FastAPI structure '${structure}'. Use one of: ${FASTAPI_STRUCTURES.join(", ")}.`);
  }

  const db = (raw.db as string | undefined) ?? "sqlite";
  if (!FASTAPI_DBS.includes(db as FastApiDb)) {
    throw new Error(`Invalid database '${db}'. Use one of: ${FASTAPI_DBS.join(", ")}.`);
  }

  return {
    structure: structure as FastApiStructure,
    db: db as FastApiDb,
    includeDocker: raw.includeDocker === true,
    // Installing shells out and needs the network, so a scripted run has to opt in.
    install: raw.install === true,
  } satisfies FastApiAddons;
}
