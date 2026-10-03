import path from "node:path";
import { writeFile } from "../../utils/fsWrite.js";
import { writeJavaSources } from "./layout.js";
import { baseYaml, devYaml, prodYaml } from "./templates/applicationYml.js";
import { dockerCompose, dockerfile } from "./templates/docker.js";
import { gitignore } from "./templates/gitignore.js";
import { writeMavenWrapper } from "./templates/mavenWrapper.js";
import { JJWT_DEPENDENCIES, dbDriverDependency, singleModulePom, type ModuleDependency } from "./templates/pom.js";
import type { JavaLayout, SpringBootAddons } from "./types.js";

/** Package-by-Layer or Package-by-Feature: a single Maven module, everything under one src tree. */
export async function generateSingleModuleSet(
  structure: "package-by-layer" | "package-by-feature",
  projectName: string,
  outDir: string,
  includeTests: boolean,
  httpPort: number,
  addons: SpringBootAddons,
  /**
   * True when Spring Initializr already wrote the build: its pom.xml, Maven
   * wrapper and .gitignore are the Spring team's current output, so overwriting
   * them with hand-pinned equivalents would throw away the reason for calling it.
   * Only the Java sources and application.yml are overlaid in that case.
   */
  buildFilesProvided = false
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

  if (!buildFilesProvided) {
    writeFile(path.join(outDir, "pom.xml"), singleModulePom(projectNameLower, deps));
    writeFile(path.join(outDir, ".gitignore"), gitignore());
  }
  const structureLabel = structure === "package-by-layer" ? "Package-by-Layer" : "Package-by-Feature";
  writeFile(path.join(outDir, "README.md"), `# ${projectName}\n\nGenerated with \`buildquick\` (Spring Boot, ${structureLabel}).\n`);

  if (includeDocker) {
    writeFile(path.join(outDir, "Dockerfile"), dockerfile());
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

  if (!buildFilesProvided) writeMavenWrapper(outDir);
}
