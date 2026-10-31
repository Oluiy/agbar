import { confirm, select } from "@clack/prompts";
import { checkCancel } from "../../utils/prompts.js";
import type { DbProvider } from "./templates/applicationYml.js";
import type { ProjectStructure, SpringBootAddons } from "./types.js";

/**
 * The input half of the Spring Boot adapter: collecting choices interactively,
 * and validating the same choices when they arrive as flags or a config file
 * instead. Kept apart from generation so the two can be read - and changed -
 * independently.
 */

export async function promptSpringBootAddons(): Promise<Record<string, unknown>> {
  const structure = checkCancel<ProjectStructure>(
    await select({
      message: "Project Structure:",
      options: [
        { value: "multi-module", label: "Multi-Module (Clean Architecture, separate Maven modules)" },
        { value: "package-by-layer", label: "Package-by-Layer (single module - the common default)" },
        { value: "package-by-feature", label: "Package-by-Feature (single module, organized by domain concept)" },
      ],
    })
  );

  let isFourLayer = false;
  if (structure === "multi-module") {
    const archChoice = checkCancel(
      await select({
        message: "Architecture Pattern:",
        options: [
          { value: "4-layer", label: "4-Layer (API, Application, Domain, Infrastructure)" },
          { value: "3-layer", label: "3-Layer (API, Application, Domain)" },
        ],
      })
    );
    isFourLayer = archChoice === "4-layer";
  }

  const dbProvider = checkCancel<DbProvider>(
    await select({
      message: "Add a database (Spring Data JPA)?",
      options: [
        { value: "none", label: "None" },
        { value: "postgres", label: "PostgreSQL" },
        { value: "mysql", label: "MySQL" },
      ],
    })
  );

  const includeJwt = checkCancel(await confirm({ message: "Add JWT Authentication boilerplate?", initialValue: false }));
  const includeDocker = checkCancel(await confirm({ message: "Add Dockerfile & docker-compose.yml?", initialValue: false }));

  // Not asked for multi-module: Initializr generates a single Maven project, so
  // there would be nothing it could contribute.
  const useInitializr =
    structure === "multi-module"
      ? false
      : checkCancel(
          await confirm({
            message: "Build it with Spring Initializr (start.spring.io)? Recommended - Spring picks the current Boot version.",
            initialValue: true,
          })
        );

  return { structure, isFourLayer, dbProvider, includeJwt, includeDocker, useInitializr } satisfies SpringBootAddons;
}

/** Non-interactive equivalent: validates raw flag/config input and fills defaults, throwing on anything invalid rather than silently generating the wrong thing. */
export function resolveSpringBootAddons(raw: Record<string, unknown>): Record<string, unknown> {
  const structure = (raw.structure as string | undefined) ?? "package-by-layer";
  const validStructures: ProjectStructure[] = ["multi-module", "package-by-layer", "package-by-feature"];
  if (!validStructures.includes(structure as ProjectStructure)) {
    throw new Error(`Invalid Spring Boot structure '${structure}'. Use one of: ${validStructures.join(", ")}.`);
  }

  // Only meaningful for multi-module, but resolved unconditionally so it's
  // always a real boolean, not undefined, downstream.
  const isFourLayer = raw.isFourLayer === undefined ? true : raw.isFourLayer === true;

  const dbProvider = (raw.dbProvider as string | undefined) ?? "none";
  const validDbProviders: DbProvider[] = ["none", "postgres", "mysql"];
  if (!validDbProviders.includes(dbProvider as DbProvider)) {
    throw new Error(`Invalid database provider '${dbProvider}'. Use one of: ${validDbProviders.join(", ")}.`);
  }

  return {
    structure: structure as ProjectStructure,
    isFourLayer,
    dbProvider: dbProvider as DbProvider,
    includeJwt: raw.includeJwt === true,
    includeDocker: raw.includeDocker === true,
    // Reaches the network, so a scripted run has to opt in: `--yes` stays offline
    // and deterministic. Meaningless for multi-module, so forced off there.
    useInitializr: raw.useInitializr === true && structure !== "multi-module",
  } satisfies SpringBootAddons;
}
