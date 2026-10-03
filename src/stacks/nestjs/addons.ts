import { confirm, select } from "@clack/prompts";
import { checkCancel } from "../../utils/prompts.js";
import { NEST_DBS, NEST_ORMS, NEST_ORMS_IMPLEMENTED, NEST_STRUCTURES, type NestAddons, type NestDb, type NestOrm, type NestStructure } from "./types.js";

export async function promptNestAddons(): Promise<Record<string, unknown>> {
  const structure = checkCancel(
    await select({
      message: "Project structure:",
      options: [
        { value: "modular", label: "Modular by feature (the NestJS default)" },
        { value: "clean", label: "Clean / hexagonal (domain, application, infrastructure per feature)" },
      ],
    })
  ) as NestStructure;

  const orm = checkCancel(
    await select({
      message: "ORM:",
      options: [
        { value: "prisma", label: "Prisma (typed client, migrations)" },
        { value: "none", label: "None (routes only)" },
      ],
    })
  ) as NestOrm;

  const db =
    orm === "none"
      ? "sqlite"
      : (checkCancel(
          await select({
            message: "Database:",
            options: [
              { value: "sqlite", label: "SQLite (no server needed - tests pass immediately)" },
              { value: "postgres", label: "PostgreSQL (docker-compose provided)" },
            ],
          })
        ) as NestDb);

  const includeDocker = checkCancel(await confirm({ message: "Add Dockerfile & docker-compose.yml?", initialValue: db === "postgres" }));
  const useCli = checkCancel(
    await confirm({
      message: "Create the base with the Nest CLI (nest new)? Recommended - it keeps dependency versions current.",
      initialValue: true,
    })
  );
  const install = checkCancel(await confirm({ message: "Install dependencies and run the tests now?", initialValue: true }));

  return { structure, orm, db, includeDocker, useCli, install } satisfies NestAddons;
}

/** Non-interactive equivalent: validates raw flag/config input and fills defaults, throwing on anything invalid rather than silently generating the wrong thing. */
export function resolveNestAddons(raw: Record<string, unknown>): Record<string, unknown> {
  const structure = (raw.structure as string | undefined) ?? "modular";
  if (!NEST_STRUCTURES.includes(structure as NestStructure)) {
    throw new Error(`Invalid NestJS structure '${structure}'. Use one of: ${NEST_STRUCTURES.join(", ")}.`);
  }

  // `dbProvider` is the Spring Boot adapter's flag name for the same idea, and
  // --db maps onto it, so it is accepted here too rather than being ignored.
  const orm = (raw.orm as string | undefined) ?? "prisma";
  if (!NEST_ORMS.includes(orm as NestOrm)) {
    throw new Error(`Invalid ORM '${orm}'. Use one of: ${NEST_ORMS.join(", ")}.`);
  }
  if (!NEST_ORMS_IMPLEMENTED.includes(orm as NestOrm)) {
    throw new Error(
      `ORM '${orm}' isn't generatable yet for NestJS - the templates are Prisma-shaped, and generating it would produce imports that don't resolve. Use one of: ${NEST_ORMS_IMPLEMENTED.join(", ")}.`
    );
  }

  const db = (raw.db as string | undefined) ?? (raw.dbProvider as string | undefined) ?? "sqlite";
  if (!NEST_DBS.includes(db as NestDb)) {
    throw new Error(`Invalid database '${db}'. Use one of: ${NEST_DBS.join(", ")}.`);
  }

  return {
    structure: structure as NestStructure,
    orm: orm as NestOrm,
    db: db as NestDb,
    includeDocker: raw.includeDocker === true,
    // Both shell out and need the network, so a scripted run has to opt in to each.
    // Defaulting useCli to false keeps `--yes` runs offline-safe and deterministic;
    // the interactive flow recommends it instead.
    useCli: raw.useCli === true,
    install: raw.install === true,
  } satisfies NestAddons;
}
