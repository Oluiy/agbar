import { confirm, select } from "@clack/prompts";
import { checkCancel } from "../../utils/prompts.js";
import { implementedOrms, ormMenuOptions } from "./orms/index.js";
import { NODE_DBS, NODE_ORMS, NODE_STRUCTURES, type NodeAddons, type NodeDb, type NodeFramework, type NodeOrm, type NodeStructure } from "./types.js";

export async function promptNodeAddons(): Promise<Record<string, unknown>> {
  const structure = checkCancel(
    await select({
      message: "Project structure:",
      options: [
        { value: "layered", label: "Layered (one feature folder: entity, repository, service, routes)" },
        { value: "clean", label: "Clean / hexagonal (domain, application, infrastructure, api)" },
      ],
    })
  ) as NodeStructure;

  const orm = checkCancel(
    await select({
      message: "ORM:",
      // Built from the plug-in registry, so a new ORM appears here the moment it exists.
      options: ormMenuOptions(),
    })
  ) as NodeOrm;

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
        ) as NodeDb);

  const includeDocker = checkCancel(await confirm({ message: "Add Dockerfile & docker-compose.yml?", initialValue: db === "postgres" && orm !== "none" }));
  const install = checkCancel(await confirm({ message: "Run npm install and the tests now? (takes minutes)", initialValue: false }));

  return { structure, orm, db, includeDocker, install } satisfies NodeAddons;
}

/** Non-interactive equivalent: validates raw flag/config input and fills defaults, throwing on anything invalid rather than silently generating the wrong thing. */
export function resolveNodeAddons(raw: Record<string, unknown>, framework: NodeFramework): Record<string, unknown> {
  const structure = (raw.structure as string | undefined) ?? "layered";
  if (!NODE_STRUCTURES.includes(structure as NodeStructure)) {
    throw new Error(`Invalid ${framework} structure '${structure}'. Use one of: ${NODE_STRUCTURES.join(", ")}.`);
  }

  const orm = (raw.orm as string | undefined) ?? "prisma";
  if (!NODE_ORMS.includes(orm as NodeOrm)) {
    throw new Error(`Invalid ORM '${orm}'. Use one of: ${implementedOrms().join(", ")}.`);
  }
  // Derived from the registered plug-ins, so it cannot drift from what can really be generated.
  if (!implementedOrms().includes(orm as NodeOrm)) {
    throw new Error(
      `ORM '${orm}' isn't generatable yet for ${framework} - generating it would produce imports that don't resolve. Use one of: ${implementedOrms().join(", ")}.`
    );
  }

  const db = (raw.db as string | undefined) ?? (raw.dbProvider as string | undefined) ?? "sqlite";
  if (!NODE_DBS.includes(db as NodeDb)) {
    throw new Error(`Invalid database '${db}'. Use one of: ${NODE_DBS.join(", ")}.`);
  }

  return {
    structure: structure as NodeStructure,
    orm: orm as NodeOrm,
    db: db as NodeDb,
    includeDocker: raw.includeDocker === true,
    // Installing shells out and needs the network, so a scripted run has to opt in.
    install: raw.install === true,
  } satisfies NodeAddons;
}
