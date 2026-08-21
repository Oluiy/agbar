import path from "node:path";
import { confirm, isCancel, select } from "@clack/prompts";
import type { ScaffoldConfig } from "../../config.js";
import type { StackAdapter } from "../StackAdapter.js";
import { writeFile } from "../../utils/fsWrite.js";
import {
  JJWT_DEPENDENCIES,
  dbDriverDependency,
  microserviceAggregatorPom,
  modulePom,
  parentPom,
  singleModulePom,
  type ModuleDependency,
} from "./templates/pom.js";
import { mainApplicationClass } from "./templates/application.js";
import { authController, healthController } from "./templates/controller.js";
import { authServiceImpl, authServiceInterface, healthServiceImpl, healthServiceInterface } from "./templates/service.js";
import { baseEntity } from "./templates/entity.js";
import { jwtAuthFilter, securityConfig } from "./templates/security.js";
import { baseYaml, devYaml, prodYaml, type DbProvider } from "./templates/applicationYml.js";
import { dockerCompose, dockerfile } from "./templates/docker.js";
import { gitignore } from "./templates/gitignore.js";
import { healthControllerTest } from "./templates/test.js";
import { writeMavenWrapper } from "./templates/mavenWrapper.js";

type ProjectStructure = "multi-module" | "package-by-layer" | "package-by-feature";

interface SpringBootAddons {
  structure: ProjectStructure;
  /** Only meaningful when structure === "multi-module". */
  isFourLayer: boolean;
  dbProvider: DbProvider;
  includeJwt: boolean;
  includeDocker: boolean;
}

function bail(): never {
  process.exit(1);
}

function checkCancel<T>(value: T | symbol): T {
  if (isCancel(value)) bail();
  return value as T;
}

/** Where one generated Java class lives: which Maven module owns it (its own root dir), and its package. */
interface FilePlacement {
  moduleRoot: string;
  pkg: string;
}

function mainSrcDir(p: FilePlacement): string {
  return path.join(p.moduleRoot, "src/main/java", ...p.pkg.split("."));
}

function testSrcDir(p: FilePlacement): string {
  return path.join(p.moduleRoot, "src/test/java", ...p.pkg.split("."));
}

interface JavaLayout {
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

// The file path to the Java source files common to every structure mode.
function writeJavaSources(layout: JavaLayout, projectName: string, includeJwt: boolean, hasDb: boolean, includeTests: boolean): void {
  writeFile(
    path.join(mainSrcDir(layout.main), `${projectName}Application.java`),
    mainApplicationClass(layout.main.pkg, projectName, hasDb, layout.scanBasePackage)
  );

  writeFile(path.join(mainSrcDir(layout.healthController), "HealthController.java"), healthController(layout.healthController.pkg, layout.healthService.pkg));
  writeFile(path.join(mainSrcDir(layout.healthService), "HealthService.java"), healthServiceInterface(layout.healthService.pkg));
  writeFile(path.join(mainSrcDir(layout.healthService), "HealthServiceImpl.java"), healthServiceImpl(layout.healthService.pkg, projectName));

  if (includeJwt) {
    writeFile(path.join(mainSrcDir(layout.authController), "AuthController.java"), authController(layout.authController.pkg, layout.authService.pkg));
    writeFile(path.join(mainSrcDir(layout.authService), "AuthService.java"), authServiceInterface(layout.authService.pkg));
    writeFile(path.join(mainSrcDir(layout.authService), "AuthServiceImpl.java"), authServiceImpl(layout.authService.pkg));
    writeFile(path.join(mainSrcDir(layout.security), "JwtAuthFilter.java"), jwtAuthFilter(layout.security.pkg));
    writeFile(path.join(mainSrcDir(layout.security), "SecurityConfig.java"), securityConfig(layout.security.pkg));
  }

  if (hasDb) {
    writeFile(path.join(mainSrcDir(layout.entity), "BaseEntity.java"), baseEntity(layout.entity.pkg));
  }

  if (includeTests) {
    writeFile(path.join(testSrcDir(layout.main), "HealthControllerTests.java"), healthControllerTest(layout.main.pkg, includeJwt, hasDb));
  }
}

/** Multi-Module: Clean Architecture enforced via separate Maven modules (today's original structure). */
async function generateMultiModuleSet(
  projectName: string,
  outDir: string,
  isFourLayer: boolean,
  includeTests: boolean,
  httpPort: number,
  addons: SpringBootAddons
): Promise<void> {
  const projectNameLower = projectName.toLowerCase();
  const basePackage = `com.buildquick.${projectNameLower}`;
  const { dbProvider, includeJwt, includeDocker } = addons;
  const hasDb = dbProvider !== "none";

  const domainRoot = path.join(outDir, `${projectNameLower}-domain`);
  const applicationRoot = path.join(outDir, `${projectNameLower}-application`);
  const infrastructureRoot = path.join(outDir, `${projectNameLower}-infrastructure`);
  const apiRoot = path.join(outDir, `${projectNameLower}-api`);

  const moduleNames = isFourLayer ? ["domain", "application", "infrastructure", "api"] : ["domain", "application", "api"];
  writeFile(path.join(outDir, "pom.xml"), parentPom(projectNameLower, moduleNames));
  writeFile(path.join(outDir, ".gitignore"), gitignore());
  writeFile(path.join(outDir, "README.md"), `# ${projectName}\n\nGenerated with \`buildquick\` (Spring Boot, Multi-Module).\n`);

  if (includeDocker) {
    writeFile(path.join(outDir, "Dockerfile"), dockerfile(projectNameLower, `${projectNameLower}-api`));
    writeFile(path.join(outDir, "docker-compose.yml"), dockerCompose(projectNameLower, httpPort, dbProvider));
  }

  const domainDeps: ModuleDependency[] = [];
  if (hasDb) {
    if (isFourLayer) {
      domainDeps.push({ groupId: "jakarta.persistence", artifactId: "jakarta.persistence-api", version: "3.2.0" });
    } else {
      domainDeps.push({ groupId: "org.springframework.boot", artifactId: "spring-boot-starter-data-jpa" });
      domainDeps.push(dbDriverDependency(dbProvider));
    }
  }
  writeFile(path.join(domainRoot, "pom.xml"), modulePom(projectNameLower, "domain", domainDeps));

  // spring-boot-starter (not -web, which belongs to the api layer) is what
  // provides @Service/@Value/@Component - the core IoC container annotations
  // HealthServiceImpl/AuthServiceImpl need regardless of any other addon.
  const applicationDeps: ModuleDependency[] = [{ groupId: "org.springframework.boot", artifactId: "spring-boot-starter" }];
  if (includeJwt) applicationDeps.push(...JJWT_DEPENDENCIES);
  writeFile(path.join(applicationRoot, "pom.xml"), modulePom(projectNameLower, "application", applicationDeps, ["domain"]));

  if (isFourLayer) {
    const infraDeps: ModuleDependency[] = hasDb
      ? [{ groupId: "org.springframework.boot", artifactId: "spring-boot-starter-data-jpa" }, dbDriverDependency(dbProvider)]
      : [];
    writeFile(path.join(infrastructureRoot, "pom.xml"), modulePom(projectNameLower, "infrastructure", infraDeps, ["domain", "application"]));
  }

  const apiModuleDeps = isFourLayer ? ["application", "infrastructure"] : ["application", "domain"];
  const apiDeps: ModuleDependency[] = [{ groupId: "org.springframework.boot", artifactId: "spring-boot-starter-web" }];
  if (hasDb) {
    // The main @SpringBootApplication class lives here and references
    // @EntityScan/@EnableJpaRepositories directly, so this module needs
    // spring-boot-starter-data-jpa on its own classpath even in 4-layer, where
    // the actual repository/DataSource wiring lives in the infrastructure module.
    apiDeps.push({ groupId: "org.springframework.boot", artifactId: "spring-boot-starter-data-jpa" });
  }
  if (includeJwt) {
    apiDeps.push({ groupId: "org.springframework.boot", artifactId: "spring-boot-starter-security" });
    apiDeps.push(...JJWT_DEPENDENCIES);
  }
  if (includeTests) {
    apiDeps.push({ groupId: "org.springframework.boot", artifactId: "spring-boot-starter-test", scope: "test" });
    apiDeps.push({ groupId: "org.springframework.boot", artifactId: "spring-boot-resttestclient", scope: "test" });
    if (hasDb) apiDeps.push({ groupId: "com.h2database", artifactId: "h2", scope: "test" });
  }
  writeFile(path.join(apiRoot, "pom.xml"), modulePom(projectNameLower, "api", apiDeps, apiModuleDeps, true));

  const layout: JavaLayout = {
    main: { moduleRoot: apiRoot, pkg: `${basePackage}.api` },
    healthController: { moduleRoot: apiRoot, pkg: `${basePackage}.api.controller` },
    healthService: { moduleRoot: applicationRoot, pkg: `${basePackage}.application.service` },
    authController: { moduleRoot: apiRoot, pkg: `${basePackage}.api.controller` },
    authService: { moduleRoot: applicationRoot, pkg: `${basePackage}.application.service` },
    security: { moduleRoot: apiRoot, pkg: `${basePackage}.api.security` },
    entity: { moduleRoot: domainRoot, pkg: `${basePackage}.domain.entity` },
    scanBasePackage: basePackage,
  };
  writeJavaSources(layout, projectName, includeJwt, hasDb, includeTests);

  const resourcesDir = path.join(apiRoot, "src/main/resources");
  writeFile(path.join(resourcesDir, "application.yml"), baseYaml(projectNameLower, httpPort, includeJwt));
  writeFile(path.join(resourcesDir, "application-dev.yml"), devYaml(projectNameLower, dbProvider, includeJwt));
  writeFile(path.join(resourcesDir, "application-prod.yml"), prodYaml(projectNameLower, dbProvider, includeJwt));

  writeMavenWrapper(outDir);
}

// Package-by-Layer or Package-by-Feature: a single Maven module, everything under one src tree.
async function generateSingleModuleSet(
  structure: "package-by-layer" | "package-by-feature",
  projectName: string,
  outDir: string,
  includeTests: boolean,
  httpPort: number,
  addons: SpringBootAddons
): Promise<void> {
  const projectNameLower = projectName.toLowerCase();
  const basePackage = `com.buildquick.${projectNameLower}`;
  const { dbProvider, includeJwt, includeDocker } = addons;
  const hasDb = dbProvider !== "none";

  const deps: ModuleDependency[] = [{ groupId: "org.springframework.boot", artifactId: "spring-boot-starter-web" }];
  if (hasDb) {
    deps.push({ groupId: "org.springframework.boot", artifactId: "spring-boot-starter-data-jpa" });
    deps.push(dbDriverDependency(dbProvider));
  }
  if (includeJwt) {
    deps.push({ groupId: "org.springframework.boot", artifactId: "spring-boot-starter-security" });
    deps.push(...JJWT_DEPENDENCIES);
  }
  if (includeTests) {
    deps.push({ groupId: "org.springframework.boot", artifactId: "spring-boot-starter-test", scope: "test" });
    deps.push({ groupId: "org.springframework.boot", artifactId: "spring-boot-resttestclient", scope: "test" });
    if (hasDb) deps.push({ groupId: "com.h2database", artifactId: "h2", scope: "test" });
  }

  writeFile(path.join(outDir, "pom.xml"), singleModulePom(projectNameLower, deps));
  writeFile(path.join(outDir, ".gitignore"), gitignore());
  const structureLabel = structure === "package-by-layer" ? "Package-by-Layer" : "Package-by-Feature";
  writeFile(path.join(outDir, "README.md"), `# ${projectName}\n\nGenerated with \`buildquick\` (Spring Boot, ${structureLabel}).\n`);

  if (includeDocker) {
    writeFile(path.join(outDir, "Dockerfile"), dockerfile(projectNameLower));
    writeFile(path.join(outDir, "docker-compose.yml"), dockerCompose(projectNameLower, httpPort, dbProvider));
  }

  const layout: JavaLayout =
    structure === "package-by-layer"
      ? {
          main: { moduleRoot: outDir, pkg: basePackage },
          healthController: { moduleRoot: outDir, pkg: `${basePackage}.controller` },
          healthService: { moduleRoot: outDir, pkg: `${basePackage}.service` },
          authController: { moduleRoot: outDir, pkg: `${basePackage}.controller` },
          authService: { moduleRoot: outDir, pkg: `${basePackage}.service` },
          security: { moduleRoot: outDir, pkg: `${basePackage}.security` },
          entity: { moduleRoot: outDir, pkg: `${basePackage}.entity` },
        }
      : {
          // Feature-cohesion is the whole point of this mode: everything for one
          // concern - controller, service, and (for auth) the security filter
          // chain - lives together in one package, regardless of technical role.
          main: { moduleRoot: outDir, pkg: basePackage },
          healthController: { moduleRoot: outDir, pkg: `${basePackage}.health` },
          healthService: { moduleRoot: outDir, pkg: `${basePackage}.health` },
          authController: { moduleRoot: outDir, pkg: `${basePackage}.auth` },
          authService: { moduleRoot: outDir, pkg: `${basePackage}.auth` },
          security: { moduleRoot: outDir, pkg: `${basePackage}.auth` },
          entity: { moduleRoot: outDir, pkg: `${basePackage}.common.entity` },
        };
  writeJavaSources(layout, projectName, includeJwt, hasDb, includeTests);

  const resourcesDir = path.join(outDir, "src/main/resources");
  writeFile(path.join(resourcesDir, "application.yml"), baseYaml(projectNameLower, httpPort, includeJwt));
  writeFile(path.join(resourcesDir, "application-dev.yml"), devYaml(projectNameLower, dbProvider, includeJwt));
  writeFile(path.join(resourcesDir, "application-prod.yml"), prodYaml(projectNameLower, dbProvider, includeJwt));

  writeMavenWrapper(outDir);
}

async function generateOne(
  structure: ProjectStructure,
  projectName: string,
  outDir: string,
  isFourLayer: boolean,
  includeTests: boolean,
  httpPort: number,
  addons: SpringBootAddons
): Promise<void> {
  if (structure === "multi-module") {
    await generateMultiModuleSet(projectName, outDir, isFourLayer, includeTests, httpPort, addons);
  } else {
    await generateSingleModuleSet(structure, projectName, outDir, includeTests, httpPort, addons);
  }
}

export const springbootAdapter: StackAdapter = {
  id: "springboot",
  label: "Spring Boot (Java + Maven)",

  async promptAddons(): Promise<Record<string, unknown>> {
    const structure = checkCancel(
      await select({
        message: "Project Structure:",
        options: [
          { value: "multi-module", label: "Multi-Module (Clean Architecture, separate Maven modules)" },
          { value: "package-by-layer", label: "Package-by-Layer (single module - the common default)" },
          { value: "package-by-feature", label: "Package-by-Feature (single module, organized by domain concept)" },
        ],
      })
    ) as ProjectStructure;

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

    const dbProvider = checkCancel(
      await select({
        message: "Add a database (Spring Data JPA)?",
        options: [
          { value: "none", label: "None" },
          { value: "postgres", label: "PostgreSQL" },
          { value: "mysql", label: "MySQL" },
        ],
      })
    ) as DbProvider;

    const includeJwt = checkCancel(
      await confirm({ message: "Add JWT Authentication boilerplate?", initialValue: false })
    );

    const includeDocker = checkCancel(
      await confirm({ message: "Add Dockerfile & docker-compose.yml?", initialValue: false })
    );

    return { structure, isFourLayer, dbProvider, includeJwt, includeDocker } satisfies SpringBootAddons;
  },

  resolveAddons(raw: Record<string, unknown>): Record<string, unknown> {
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

    const includeJwt = raw.includeJwt === true;
    const includeDocker = raw.includeDocker === true;

    return {
      structure: structure as ProjectStructure,
      isFourLayer,
      dbProvider: dbProvider as DbProvider,
      includeJwt,
      includeDocker,
    } satisfies SpringBootAddons;
  },

  async generate(config: ScaffoldConfig, outDir: string): Promise<void> {
    const addons = config.addons as unknown as SpringBootAddons;

    if (config.isMicroservice) {
      const servicesDir = path.join(outDir, "services");
      for (const serviceName of config.serviceNames) {
        await generateOne(addons.structure, serviceName, path.join(servicesDir, serviceName), addons.isFourLayer, config.includeTests, config.httpPort, addons);
      }
      // A lightweight reactor root so "mvn install" from here builds every
      // service in one shot; each service stays fully independent underneath.
      writeFile(path.join(outDir, "pom.xml"), microserviceAggregatorPom(config.projectName.toLowerCase(), config.serviceNames));
      writeFile(path.join(outDir, "README.md"), `# ${config.projectName}\n\nGenerated with \`buildquick\` (Spring Boot, microservices).\n`);
      writeFile(path.join(outDir, ".gitignore"), gitignore());
      writeMavenWrapper(outDir);
    } else {
      await generateOne(addons.structure, config.projectName, outDir, addons.isFourLayer, config.includeTests, config.httpPort, addons);
    }
  },
};
