import path from "node:path";
import type { ScaffoldConfig } from "../../config.js";
import { writeFile } from "../../utils/fsWrite.js";
import type { GenerateResult, StackAdapter } from "../StackAdapter.js";
import { promptFastApiAddons, resolveFastApiAddons } from "./addons.js";
import { installAndTest } from "./install.js";
import { pathsFor } from "./layout.js";
import { alembicEnvPy, alembicIni, alembicScriptMako, initialMigrationPy } from "./templates/alembic.js";
import { apiRouterPy, healthRoutePy, itemsRoutePy } from "./templates/api.js";
import { basePy, configPy, depsPy, mainPy, sessionPy } from "./templates/app.js";
import { dockerCompose, dockerfile } from "./templates/docker.js";
import { entityPy, modelPy, repoPortPy, repositoryPy, schemaPy, servicePy } from "./templates/domain.js";
import { architectureMd, envExample, gitignore, pyprojectToml, readmeMd, requirementsDevTxt, requirementsTxt } from "./templates/project.js";
import { conftestPy, testHealthPy, testItemsPy, testServiceUnitPy } from "./templates/tests.js";
import type { FastApiAddons } from "./types.js";

/**
 * The FastAPI StackAdapter. Thin by design: it decides which files a given
 * structure needs and where they go (via layout.ts), while every file's contents
 * come from templates/ and the verification step lives in install.ts.
 *
 * `generate` is pure file writing and always safe to run; the optional install
 * step afterwards is what proves the result actually imports and passes its tests.
 */

export const fastapiAdapter: StackAdapter = {
  id: "fastapi",
  label: "FastAPI (Python + SQLAlchemy/Alembic)",

  promptAddons: promptFastApiAddons,
  resolveAddons: resolveFastApiAddons,

  async generate(config: ScaffoldConfig, outDir: string): Promise<GenerateResult> {
    const addons = config.addons as unknown as FastApiAddons;
    const { structure, db, includeDocker } = addons;
    const paths = pathsFor(structure);
    const isClean = structure === "clean";
    const hasDb = db !== "none";
    const name = config.projectName;

    const write = (relPath: string, contents: string) => writeFile(path.join(outDir, relPath), contents);

    // Python needs __init__.py for a directory to be an importable package, and a
    // missing one fails at import time rather than at generate time - so every
    // package that gets a file gets one too. Packages that only exist to hold
    // database code are skipped when there is no database: an empty app/models/
    // with nothing but __init__.py is a worse starting point than no folder.
    const dbOnly = new Set(
      [
        paths.baseFile,
        paths.sessionFile,
        paths.modelFile,
        paths.schemaFile,
        paths.repoFile,
        paths.serviceFile,
        paths.itemsRouteFile,
        paths.entityFile,
        paths.repoPortFile,
      ].map((f) => (f ? path.posix.dirname(f) : ""))
    );
    for (const pkg of paths.packages) {
      if (!hasDb && dbOnly.has(pkg)) continue;
      write(`${pkg}/__init__.py`, "");
    }

    write(paths.mainFile, mainPy(paths, name, db));
    write(paths.configFile, configPy(name, db));
    write(paths.apiRouterFile, apiRouterPy(paths, db));
    write(paths.healthRouteFile, healthRoutePy(paths, db));
    write(paths.depsFile, depsPy(paths, db, isClean));

    if (hasDb) {
      write(paths.baseFile, basePy());
      write(paths.sessionFile, sessionPy(paths, db));
      write(paths.modelFile, modelPy(paths));
      write(paths.schemaFile, schemaPy());
      write(paths.repoFile, repositoryPy(paths, isClean));
      write(paths.serviceFile, servicePy(paths, isClean));
      write(paths.itemsRouteFile, itemsRoutePy(paths));

      if (isClean) {
        // Only this layout separates the domain entity from the table, so only it
        // needs the entity and the Protocol the domain declares.
        write(paths.entityFile!, entityPy());
        write(paths.repoPortFile!, repoPortPy(paths));
      }

      write("alembic.ini", alembicIni());
      write("migrations/env.py", alembicEnvPy(paths));
      write("migrations/script.py.mako", alembicScriptMako());
      write("migrations/versions/0001_create_items.py", initialMigrationPy());
    }

    if (config.includeTests) {
      write("tests/__init__.py", "");
      write("tests/conftest.py", conftestPy(paths, db));
      write("tests/test_health.py", testHealthPy(db));
      if (hasDb) {
        write("tests/test_items.py", testItemsPy());
        write("tests/unit/__init__.py", "");
        write("tests/unit/test_item_service.py", testServiceUnitPy(paths, isClean));
      }
    }

    write("pyproject.toml", pyprojectToml(name, db));
    write("requirements.txt", requirementsTxt(db));
    write("requirements-dev.txt", requirementsDevTxt());
    write(".env.example", envExample(name, db));
    write(".gitignore", gitignore(name, db));
    write("README.md", readmeMd(name, db, structure));
    write("ARCHITECTURE.md", architectureMd(name, structure, db));

    if (includeDocker) {
      write("Dockerfile", dockerfile(db));
      write("docker-compose.yml", dockerCompose(name, db));
    }

    return { verify: addons.install ? await installAndTest(outDir) : undefined };
  },
};
