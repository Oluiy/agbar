import type { FastApiStructure } from "./types.js";

/**
 * Where each piece of the project lives, per architecture. Python couples file
 * location to import path, so moving a file means rewriting every import of it -
 * which is exactly why this is one table instead of being spread through the
 * templates. A template is handed the paths and never decides them.
 *
 * `*File` is relative to the project root; `*Mod` is the dotted import path.
 */
export interface FastApiPaths {
  mainFile: string;
  configFile: string;
  configMod: string;
  baseFile: string;
  baseMod: string;
  sessionFile: string;
  sessionMod: string;
  /** The SQLAlchemy model (in "clean", the infrastructure table mapping). */
  modelFile: string;
  modelMod: string;
  /** Pydantic request/response models. */
  schemaFile: string;
  schemaMod: string;
  repoFile: string;
  repoMod: string;
  serviceFile: string;
  serviceMod: string;
  depsFile: string;
  depsMod: string;
  apiRouterFile: string;
  apiRouterMod: string;
  healthRouteFile: string;
  healthRouteMod: string;
  itemsRouteFile: string;
  itemsRouteMod: string;
  /** "clean" only: the pure domain entity and the repository interface it declares. */
  entityFile?: string;
  entityMod?: string;
  repoPortFile?: string;
  repoPortMod?: string;
  /** Every directory that needs an `__init__.py` to be an importable package. */
  packages: string[];
}

const LAYERED: FastApiPaths = {
  mainFile: "app/main.py",
  configFile: "app/core/config.py",
  configMod: "app.core.config",
  baseFile: "app/db/base.py",
  baseMod: "app.db.base",
  sessionFile: "app/db/session.py",
  sessionMod: "app.db.session",
  modelFile: "app/models/item.py",
  modelMod: "app.models.item",
  schemaFile: "app/schemas/item.py",
  schemaMod: "app.schemas.item",
  repoFile: "app/repositories/item_repository.py",
  repoMod: "app.repositories.item_repository",
  serviceFile: "app/services/item_service.py",
  serviceMod: "app.services.item_service",
  depsFile: "app/api/deps.py",
  depsMod: "app.api.deps",
  apiRouterFile: "app/api/router.py",
  apiRouterMod: "app.api.router",
  healthRouteFile: "app/api/routes/health.py",
  healthRouteMod: "app.api.routes.health",
  itemsRouteFile: "app/api/routes/items.py",
  itemsRouteMod: "app.api.routes.items",
  packages: ["app", "app/core", "app/db", "app/models", "app/schemas", "app/repositories", "app/services", "app/api", "app/api/routes"],
};

/** One folder per domain concept: everything about "items" is in app/modules/items. */
const MODULAR: FastApiPaths = {
  mainFile: "app/main.py",
  configFile: "app/core/config.py",
  configMod: "app.core.config",
  baseFile: "app/core/db/base.py",
  baseMod: "app.core.db.base",
  sessionFile: "app/core/db/session.py",
  sessionMod: "app.core.db.session",
  modelFile: "app/modules/items/models.py",
  modelMod: "app.modules.items.models",
  schemaFile: "app/modules/items/schemas.py",
  schemaMod: "app.modules.items.schemas",
  repoFile: "app/modules/items/repository.py",
  repoMod: "app.modules.items.repository",
  serviceFile: "app/modules/items/service.py",
  serviceMod: "app.modules.items.service",
  depsFile: "app/core/deps.py",
  depsMod: "app.core.deps",
  apiRouterFile: "app/router.py",
  apiRouterMod: "app.router",
  healthRouteFile: "app/modules/health/router.py",
  healthRouteMod: "app.modules.health.router",
  itemsRouteFile: "app/modules/items/router.py",
  itemsRouteMod: "app.modules.items.router",
  packages: ["app", "app/core", "app/core/db", "app/modules", "app/modules/health", "app/modules/items"],
};

/**
 * Dependencies point inward: the domain declares an ItemRepository interface and
 * knows nothing about SQLAlchemy; infrastructure implements it. That indirection
 * is the whole point, and it is why this layout has two extra files.
 */
const CLEAN: FastApiPaths = {
  mainFile: "app/main.py",
  configFile: "app/core/config.py",
  configMod: "app.core.config",
  baseFile: "app/infrastructure/db/base.py",
  baseMod: "app.infrastructure.db.base",
  sessionFile: "app/infrastructure/db/session.py",
  sessionMod: "app.infrastructure.db.session",
  modelFile: "app/infrastructure/db/models.py",
  modelMod: "app.infrastructure.db.models",
  schemaFile: "app/api/schemas.py",
  schemaMod: "app.api.schemas",
  repoFile: "app/infrastructure/db/item_repository.py",
  repoMod: "app.infrastructure.db.item_repository",
  serviceFile: "app/application/item_service.py",
  serviceMod: "app.application.item_service",
  depsFile: "app/api/deps.py",
  depsMod: "app.api.deps",
  apiRouterFile: "app/api/router.py",
  apiRouterMod: "app.api.router",
  healthRouteFile: "app/api/routes/health.py",
  healthRouteMod: "app.api.routes.health",
  itemsRouteFile: "app/api/routes/items.py",
  itemsRouteMod: "app.api.routes.items",
  entityFile: "app/domain/item.py",
  entityMod: "app.domain.item",
  repoPortFile: "app/domain/repositories.py",
  repoPortMod: "app.domain.repositories",
  packages: ["app", "app/core", "app/domain", "app/application", "app/infrastructure", "app/infrastructure/db", "app/api", "app/api/routes"],
};

export function pathsFor(structure: FastApiStructure): FastApiPaths {
  if (structure === "modular") return MODULAR;
  if (structure === "clean") return CLEAN;
  return LAYERED;
}
