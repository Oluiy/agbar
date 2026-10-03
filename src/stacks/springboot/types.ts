import type { DbProvider } from "./templates/applicationYml.js";

export type ProjectStructure = "multi-module" | "package-by-layer" | "package-by-feature";

export interface SpringBootAddons {
  structure: ProjectStructure;
  /** Only meaningful when structure === "multi-module". */
  isFourLayer: boolean;
  dbProvider: DbProvider;
  includeJwt: boolean;
  includeDocker: boolean;
  /**
   * Create the build with Spring Initializr (start.spring.io) and overlay the Java
   * sources on top, instead of writing a hand-pinned pom.xml. Preferred: Spring
   * manages the Boot version and the starter set, so a generated project does not
   * go stale as this repo's pins do.
   *
   * Ignored for multi-module, which Initializr cannot produce. Falls back to the
   * hand-written pom automatically when offline.
   */
  useInitializr: boolean;
}

/** Where one generated Java class lives: which Maven module owns it (its own root dir), and its package. */
export interface FilePlacement {
  moduleRoot: string;
  pkg: string;
}

/**
 * Every Java class this stack generates, and where it goes. The three structure
 * modes differ only in how they fill this in - which is what lets multiModule.ts
 * and singleModule.ts share one set of templates.
 */
export interface JavaLayout {
  main: FilePlacement;
  healthController: FilePlacement;
  healthService: FilePlacement;
  authController: FilePlacement;
  authService: FilePlacement;
  security: FilePlacement;
  entity: FilePlacement;
  /** Set only when the main class's own package doesn't already cover every other placement via Spring Boot's default scan (Multi-Module, where Service/Entity classes live in sibling Maven modules). */
  scanBasePackage?: string;
}
