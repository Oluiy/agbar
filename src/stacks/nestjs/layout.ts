import type { NestStructure } from "./types.js";

/**
 * Where each piece lives, per structure. TypeScript imports are relative, so unlike
 * Python a move does not change an import path's shape - but having one table still
 * keeps "which files exist" in a single readable place.
 */
export interface NestPaths {
  /** The feature's directory, used to build the relative imports between its files. */
  featureDir: string;
  controller: string;
  service: string;
  repository: string;
  dto: string;
  module: string;
  /** "clean" only: the entity and the repository port the domain declares. */
  entity?: string;
  repositoryPort?: string;
}

const MODULAR: NestPaths = {
  featureDir: "src/modules/items",
  controller: "src/modules/items/items.controller.ts",
  service: "src/modules/items/items.service.ts",
  repository: "src/modules/items/items.repository.ts",
  dto: "src/modules/items/dto/item.dto.ts",
  module: "src/modules/items/items.module.ts",
};

const CLEAN: NestPaths = {
  featureDir: "src/modules/items",
  controller: "src/modules/items/api/items.controller.ts",
  service: "src/modules/items/application/items.service.ts",
  repository: "src/modules/items/infrastructure/prisma-items.repository.ts",
  dto: "src/modules/items/api/dto/item.dto.ts",
  module: "src/modules/items/items.module.ts",
  entity: "src/modules/items/domain/item.entity.ts",
  repositoryPort: "src/modules/items/domain/items.repository.port.ts",
};

export function pathsFor(structure: NestStructure): NestPaths {
  return structure === "clean" ? CLEAN : MODULAR;
}
