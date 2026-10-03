import path from "node:path";
import type { ScaffoldConfig } from "../../config.js";
import { writeFile } from "../../utils/fsWrite.js";
import type { GenerateResult, StackAdapter } from "../StackAdapter.js";
import { promptNestAddons, resolveNestAddons } from "./addons.js";
import { bootstrapWithNestCli, mergePackageJson, removeCliDefaults } from "./bootstrap.js";
import { NEST_VERSIONS } from "./versions.js";
import { installAndTest } from "./install.js";
import { pathsFor } from "./layout.js";
import {
  appModuleTs,
  configurationTs,
  healthControllerTs,
  healthModuleTs,
  mainTs,
  prismaConfigTs,
  prismaModuleTs,
  prismaSchema,
  prismaServiceTs,
} from "./templates/app.js";
import { dockerCompose, dockerfile } from "./templates/docker.js";
import { controllerTs, dtoTs, entityTs, moduleTs, repositoryPortTs, repositoryTs, serviceTs } from "./templates/feature.js";
import {
  architectureMd,
  envExample,
  gitignore,
  jestE2eJson,
  nestCliJson,
  packageAdditions,
  packageJson,
  prepareE2eDbMjs,
  readmeMd,
  setDatabaseUrlJs,
  tsconfigBuildJson,
  tsconfigJson,
} from "./templates/project.js";
import { appE2eSpecTs, healthSpecTs, serviceSpecTs } from "./templates/tests.js";
import type { NestAddons } from "./types.js";

/**
 * The NestJS StackAdapter. Thin by design: it decides which files a structure
 * needs and where they go (layout.ts), while contents come from templates/ and the
 * "does it actually work?" step lives in install.ts.
 */

export const nestjsAdapter: StackAdapter = {
  id: "nestjs",
  label: "NestJS (TypeScript + Prisma)",

  promptAddons: promptNestAddons,
  resolveAddons: resolveNestAddons,

  async generate(config: ScaffoldConfig, outDir: string): Promise<GenerateResult> {
    const addons = config.addons as unknown as NestAddons;
    const { structure, orm, db, includeDocker } = addons;
    const paths = pathsFor(structure);
    const isClean = structure === "clean";
    const hasOrm = orm !== "none";
    const name = config.projectName;

    const write = (relPath: string, contents: string) => writeFile(path.join(outDir, relPath), contents);

    // Prefer the framework's own CLI for the base: `nest new` ships a dependency
    // set the Nest team has proven compatible, which is the single biggest source
    // of "generated project does not install" bugs removed. Falls back silently to
    // writing the base here when npx is missing or the CLI fails.
    const usedCli = addons.useCli ? await bootstrapWithNestCli(path.dirname(outDir), path.basename(outDir), NEST_VERSIONS.nestCli.replace(/^\^/, "")) : false;
    if (usedCli) removeCliDefaults(outDir);

    write("src/main.ts", mainTs());
    write("src/app.module.ts", appModuleTs(orm));
    write("src/config/configuration.ts", configurationTs(orm));
    write("src/health/health.controller.ts", healthControllerTs(orm));
    write("src/health/health.module.ts", healthModuleTs(orm));

    if (orm === "prisma") {
      write("src/prisma/prisma.service.ts", prismaServiceTs(db));
      write("src/prisma/prisma.module.ts", prismaModuleTs());
      write("prisma/schema.prisma", prismaSchema(db));
      write("prisma.config.ts", prismaConfigTs());
    }

    if (hasOrm) {
      write(paths.controller, controllerTs(isClean));
      write(paths.service, serviceTs(isClean));
      write(paths.repository, repositoryTs(isClean));
      write(paths.dto, dtoTs());
      write(paths.module, moduleTs(isClean));
      if (isClean) {
        // Only this structure separates the entity from the table and names the
        // port the domain depends on.
        write(paths.entity!, entityTs());
        write(paths.repositoryPort!, repositoryPortTs());
      }
    }

    if (config.includeTests) {
      write("src/health/health.controller.spec.ts", healthSpecTs(orm));
      if (hasOrm) {
        // Beside the service it tests: Jest's testRegex scans src/, and a unit test
        // next to its subject is one less folder to keep in sync.
        write(path.posix.join(path.posix.dirname(paths.service), "items.service.spec.ts"), serviceSpecTs(isClean));
        write("test/app.e2e-spec.ts", appE2eSpecTs(orm));
        write("jest-e2e.json", jestE2eJson());
        // The e2e suite gets its own database; see prepareE2eDbMjs for why it must.
        write("scripts/prepare-e2e-db.mjs", prepareE2eDbMjs(db, name));
        write("test/set-database-url.js", setDatabaseUrlJs(db, name));
      }
    }

    if (usedCli) {
      // The CLI already wrote package.json, tsconfig and nest-cli.json. Only the
      // extra dependencies and scripts are merged in, so its version choices stand.
      mergePackageJson(outDir, packageAdditions(orm, db));
    } else {
      write("package.json", packageJson(name, orm, db));
      write("tsconfig.json", tsconfigJson());
      write("tsconfig.build.json", tsconfigBuildJson());
      write("nest-cli.json", nestCliJson());
    }
    write(".env.example", envExample(name, orm, db));
    // Also written as .env: Prisma's CLI reads DATABASE_URL from it, so without one
    // `prisma generate` fails on a fresh clone before anyone has copied the example.
    if (hasOrm) write(".env", envExample(name, orm, db));
    write(".gitignore", gitignore(orm));
    write("README.md", readmeMd(name, structure, orm, db));
    write("ARCHITECTURE.md", architectureMd(name, structure, orm));

    if (includeDocker) {
      write("Dockerfile", dockerfile(orm, db));
      write("docker-compose.yml", dockerCompose(name, orm, db));
    }

    return { verify: addons.install ? await installAndTest(outDir, orm) : undefined };
  },
};
