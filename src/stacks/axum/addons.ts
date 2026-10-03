import { confirm, select } from "@clack/prompts";
import { checkCancel } from "../../utils/prompts.js";
import { AXUM_DBS, AXUM_STRUCTURES, type AxumAddons, type AxumDb, type AxumStructure } from "./types.js";

export async function promptAxumAddons(): Promise<Record<string, unknown>> {
  const structure = checkCancel(
    await select({
      message: "Project structure:",
      options: [
        { value: "layered", label: "Layered (one feature folder: entity, repository, service, handlers)" },
        { value: "clean", label: "Clean / hexagonal (domain, application, infrastructure, api)" },
      ],
    })
  ) as AxumStructure;

  const db = checkCancel(
    await select({
      message: "Database (sqlx):",
      options: [
        { value: "sqlite", label: "SQLite (no server needed - tests pass immediately)" },
        { value: "postgres", label: "PostgreSQL (docker-compose provided)" },
      ],
    })
  ) as AxumDb;

  const includeDocker = checkCancel(await confirm({ message: "Add Dockerfile & docker-compose.yml?", initialValue: db === "postgres" }));
  const useCli = checkCancel(
    await confirm({ message: "Create the crate with cargo new + cargo add? Recommended - cargo picks current versions.", initialValue: true })
  );
  const install = checkCancel(await confirm({ message: "Build and run the tests now (cargo test)?", initialValue: true }));

  return { structure, db, includeDocker, useCli, install } satisfies AxumAddons;
}

/** Non-interactive equivalent: validates raw flag/config input and fills defaults, throwing on anything invalid rather than silently generating the wrong thing. */
export function resolveAxumAddons(raw: Record<string, unknown>): Record<string, unknown> {
  const structure = (raw.structure as string | undefined) ?? "layered";
  if (!AXUM_STRUCTURES.includes(structure as AxumStructure)) {
    throw new Error(`Invalid Axum structure '${structure}'. Use one of: ${AXUM_STRUCTURES.join(", ")}.`);
  }

  const db = (raw.db as string | undefined) ?? (raw.dbProvider as string | undefined) ?? "sqlite";
  if (!AXUM_DBS.includes(db as AxumDb)) {
    throw new Error(`Invalid database '${db}'. Use one of: ${AXUM_DBS.join(", ")}.`);
  }

  return {
    structure: structure as AxumStructure,
    db: db as AxumDb,
    includeDocker: raw.includeDocker === true,
    // Both reach the network, so a scripted run has to opt in to each.
    useCli: raw.useCli === true,
    install: raw.install === true,
  } satisfies AxumAddons;
}
