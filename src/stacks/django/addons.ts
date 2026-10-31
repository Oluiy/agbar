import { confirm, select } from "@clack/prompts";
import { checkCancel } from "../../utils/prompts.js";
import { DJANGO_DBS, DJANGO_STRUCTURES, type DjangoAddons, type DjangoDb, type DjangoStructure } from "./types.js";

export async function promptDjangoAddons(): Promise<Record<string, unknown>> {
  const structure = checkCancel<DjangoStructure>(
    await select({
      message: "Project structure:",
      options: [
        { value: "standard", label: "Standard Django (models, serializers, generic views)" },
        { value: "service-layer", label: "Service layer (services.py for writes, selectors.py for reads)" },
      ],
    })
  );

  const db = checkCancel<DjangoDb>(
    await select({
      message: "Database:",
      options: [
        { value: "sqlite", label: "SQLite (no server needed - tests pass immediately)" },
        { value: "postgres", label: "PostgreSQL (psycopg; docker-compose provided)" },
      ],
    })
  );

  const includeDocker = checkCancel(await confirm({ message: "Add Dockerfile & docker-compose.yml?", initialValue: db === "postgres" }));
  const useCli = checkCancel(await confirm({ message: "Use django-admin startproject for the base (when Django is installed)?", initialValue: true }));
  const install = checkCancel(await confirm({ message: "Create a venv, install dependencies and run the tests now? (takes minutes)", initialValue: false }));

  return { structure, db, includeDocker, useCli, install } satisfies DjangoAddons;
}

/** Non-interactive equivalent: validates raw flag/config input and fills defaults, throwing on anything invalid rather than silently generating the wrong thing. */
export function resolveDjangoAddons(raw: Record<string, unknown>): Record<string, unknown> {
  const structure = (raw.structure as string | undefined) ?? "standard";
  if (!DJANGO_STRUCTURES.includes(structure as DjangoStructure)) {
    throw new Error(`Invalid Django structure '${structure}'. Use one of: ${DJANGO_STRUCTURES.join(", ")}.`);
  }

  const db = (raw.db as string | undefined) ?? (raw.dbProvider as string | undefined) ?? "sqlite";
  if (!DJANGO_DBS.includes(db as DjangoDb)) {
    throw new Error(`Invalid database '${db}'. Use one of: ${DJANGO_DBS.join(", ")}.`);
  }

  return {
    structure: structure as DjangoStructure,
    db: db as DjangoDb,
    includeDocker: raw.includeDocker === true,
    // Both shell out, so a scripted run has to opt in to each.
    useCli: raw.useCli === true,
    install: raw.install === true,
  } satisfies DjangoAddons;
}
