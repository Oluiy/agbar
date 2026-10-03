import path from "node:path";
import type { NodeOrm, NodeStructure } from "./types.js";

/**
 * Where each piece of the example feature lives, per structure. ESM TypeScript needs
 * every relative import to carry a ".js" extension and to be correct from the
 * *importing* file, so templates ask `rel(from, to)` instead of hard-coding paths.
 */
export interface NodePaths {
  entity: string;
  repository: string;
  /** The ORM's implementation of the repository interface; named after the ORM. */
  ormRepository: string;
  service: string;
  schemas: string;
  http: string;
}

export function pathsFor(structure: NodeStructure, orm: NodeOrm = "prisma"): NodePaths {
  if (structure === "clean") {
    return {
      entity: "src/domain/item.ts",
      repository: "src/domain/items-repository.ts",
      ormRepository: `src/infrastructure/${orm}-items-repository.ts`,
      service: "src/application/items-service.ts",
      schemas: "src/api/schemas.ts",
      http: "src/api/http.ts",
    };
  }
  return {
    entity: "src/items/entity.ts",
    repository: "src/items/repository.ts",
    ormRepository: `src/items/${orm}-repository.ts`,
    service: "src/items/service.ts",
    schemas: "src/items/schemas.ts",
    http: "src/items/http.ts",
  };
}

/** The import specifier for `to`, written from inside `from`: "./entity.js", "../errors.js". */
export function rel(from: string, to: string): string {
  const relative = path.posix.relative(path.posix.dirname(from), to).replace(/\.ts$/, ".js");
  return relative.startsWith(".") ? relative : `./${relative}`;
}

/** "ItemsApi" -> "items-api": a valid npm package name. */
export function toPackageName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}
