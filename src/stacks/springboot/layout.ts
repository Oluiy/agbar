import path from "node:path";
import { writeFile } from "../../utils/fsWrite.js";
import { mainApplicationClass } from "./templates/application.js";
import { authController, healthController } from "./templates/controller.js";
import { baseEntity } from "./templates/entity.js";
import { jwtAuthFilter, securityConfig } from "./templates/security.js";
import { authServiceImpl, authServiceInterface, healthServiceImpl, healthServiceInterface } from "./templates/service.js";
import { healthControllerTest } from "./templates/test.js";
import type { FilePlacement, JavaLayout } from "./types.js";

/**
 * The Java sources common to every structure mode. Multi-Module and the two
 * single-module modes decide *where* classes go (the JavaLayout); this decides
 * *what* gets written, once, for all of them.
 */

export function mainSrcDir(p: FilePlacement): string {
  return path.join(p.moduleRoot, "src/main/java", ...p.pkg.split("."));
}

export function testSrcDir(p: FilePlacement): string {
  return path.join(p.moduleRoot, "src/test/java", ...p.pkg.split("."));
}

export function writeJavaSources(layout: JavaLayout, projectName: string, includeJwt: boolean, hasDb: boolean, includeTests: boolean): void {
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
