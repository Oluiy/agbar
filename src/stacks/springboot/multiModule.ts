import path from "node:path";
import { writeFile } from "../../utils/fsWrite.js";
import { writeJavaSources } from "./layout.js";
import { baseYaml, devYaml, prodYaml } from "./templates/applicationYml.js";
import { dockerCompose, dockerfile } from "./templates/docker.js";
import { gitignore } from "./templates/gitignore.js";
import { writeMavenWrapper } from "./templates/mavenWrapper.js";
import { JJWT_DEPENDENCIES, dbDriverDependency, modulePom, parentPom, type ModuleDependency } from "./templates/pom.js";
import type { JavaLayout, SpringBootAddons } from "./types.js";

/** Multi-Module: Clean Architecture enforced via separate Maven modules, so the layer boundaries are compile-time rather than conventional. */
export async function generateMultiModuleSet(
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
    writeFile(path.join(outDir, "Dockerfile"), dockerfile(`${projectNameLower}-api`));
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
