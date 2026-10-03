import type { AxumStructure } from "./types.js";

/**
 * Where each piece lives, per structure, with its Rust module path. Rust couples a
 * file's location to the path other files `use` it by, so this is one table rather
 * than strings scattered through the templates.
 */
export interface AxumPaths {
  /** Top-level modules declared in lib.rs. */
  topModules: string[];
  /** Every mod.rs, with the child modules it declares. */
  modFiles: { file: string; children: string[] }[];
  entityFile: string;
  entityMod: string;
  repositoryFile: string;
  repositoryMod: string;
  sqlxFile: string;
  sqlxMod: string;
  serviceFile: string;
  serviceMod: string;
  handlersFile: string;
  handlersMod: string;
}

const LAYERED: AxumPaths = {
  topModules: ["items"],
  modFiles: [{ file: "src/items/mod.rs", children: ["entity", "handlers", "repository", "service", "sqlx_repository"] }],
  entityFile: "src/items/entity.rs",
  entityMod: "crate::items::entity",
  repositoryFile: "src/items/repository.rs",
  repositoryMod: "crate::items::repository",
  sqlxFile: "src/items/sqlx_repository.rs",
  sqlxMod: "crate::items::sqlx_repository",
  serviceFile: "src/items/service.rs",
  serviceMod: "crate::items::service",
  handlersFile: "src/items/handlers.rs",
  handlersMod: "crate::items::handlers",
};

const CLEAN: AxumPaths = {
  topModules: ["api", "application", "domain", "infrastructure"],
  modFiles: [
    { file: "src/domain/mod.rs", children: ["item", "repository"] },
    { file: "src/application/mod.rs", children: ["service"] },
    { file: "src/infrastructure/mod.rs", children: ["sqlx_repository"] },
    { file: "src/api/mod.rs", children: ["handlers"] },
  ],
  entityFile: "src/domain/item.rs",
  entityMod: "crate::domain::item",
  repositoryFile: "src/domain/repository.rs",
  repositoryMod: "crate::domain::repository",
  sqlxFile: "src/infrastructure/sqlx_repository.rs",
  sqlxMod: "crate::infrastructure::sqlx_repository",
  serviceFile: "src/application/service.rs",
  serviceMod: "crate::application::service",
  handlersFile: "src/api/handlers.rs",
  handlersMod: "crate::api::handlers",
};

export function pathsFor(structure: AxumStructure): AxumPaths {
  return structure === "clean" ? CLEAN : LAYERED;
}

/** "ItemsApi" -> "items_api": the crate name Rust code `use`s. */
export function toSnake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

/** "ItemsApi" -> "items-api": the package name cargo expects (kebab-case). */
export function toKebab(name: string): string {
  return toSnake(name).replace(/_/g, "-");
}
