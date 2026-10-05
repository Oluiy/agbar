import path from "node:path";
import type { ScaffoldConfig } from "../../config.js";
import { writeFile } from "../../utils/fsWrite.js";
import type { StackAdapter } from "../StackAdapter.js";
import { promptNodeAddons, resolveNodeAddons } from "./addons.js";
import { installAndTest } from "./install.js";
import { pathsFor } from "./layout.js";
import { ormPlugin } from "./orms/index.js";
import { configTs, databaseTs, expressAppTs, fastifyAppTs, serverTs } from "./templates/app.js";
import { entityTs, errorsTs, httpTs, repositoryTs, schemasTs, serviceTs } from "./templates/feature.js";
import {
  architectureMd,
  dockerCompose,
  dockerfile,
  envExample,
  gitignore,
  packageJson,
  readmeMd,
  tsconfigBuildJson,
  tsconfigJson,
  vitestConfigTs,
} from "./templates/project.js";
import { fakesTs, globalSetupTs, httpTestTs, repositoryTestTs, serviceTestTs } from "./templates/tests.js";
import type { NodeAddons, NodeFramework } from "./types.js";

/**
 * Express and Fastify are the same project with a different HTTP layer, so one factory
 * builds both adapters. Everything below the web framework - config, errors, the
 * feature's entity/repository/service/schemas, Prisma, tests, Docker - is shared; only
 * app.ts, server.ts, the routes file and the HTTP test harness differ.
 *
 * Neither framework has a maintained TypeScript scaffolder to delegate to (Express's
 * generator emits JavaScript and Pug views; `fastify generate` emits a plugin-autoload
 * layout this scaffold does not use), so versions come from versions.ts as verified caret
 * majors, which npm resolves to the newest compatible release at install time.
 */
function makeNodeAdapter(framework: NodeFramework, label: string): StackAdapter {
  return {
    id: framework,
    label,

    promptAddons: promptNodeAddons,
    resolveAddons: (raw) => resolveNodeAddons(raw, framework),

    capabilities: { microservices: false, port: false },

    async generate(config: ScaffoldConfig, outDir: string): Promise<void> {
      const addons = config.addons as unknown as NodeAddons;
      const { structure, orm, db, includeDocker } = addons;
      const paths = pathsFor(structure, orm);
      const name = config.projectName;
      const plugin = ormPlugin(orm);
      const ormContext = { projectName: name, db, structure, paths };

      const write = (relPath: string, contents: string) => writeFile(path.join(outDir, relPath), contents);

      write("package.json", packageJson(name, framework, orm, db));
      write("tsconfig.json", tsconfigJson());
      write("tsconfig.build.json", tsconfigBuildJson());

      write("src/config.ts", configTs(name, orm, db));
      write("src/errors.ts", errorsTs());
      write("src/app.ts", framework === "express" ? expressAppTs({ paths, orm }) : fastifyAppTs({ paths, orm }));
      write("src/server.ts", serverTs(framework, { paths, orm }));

      if (plugin) {
        write("src/database.ts", databaseTs(paths));
        // db.ts (exporting connect), the repository implementation, and any schema or
        // config files this ORM needs.
        for (const file of plugin.files(ormContext)) write(file.path, file.content);

        write(paths.entity, entityTs(structure));
        write(paths.repository, repositoryTs(paths));
        write(paths.service, serviceTs(paths));
        write(paths.schemas, schemasTs());
        write(paths.http, httpTs(paths, framework));
      }

      if (config.includeTests) {
        write("vitest.config.ts", vitestConfigTs(orm));
        write("test/http.test.ts", httpTestTs(framework, orm, paths));
        if (plugin) {
          write("test/fakes.ts", fakesTs(paths));
          write("test/service.test.ts", serviceTestTs(paths));
          write("test/repository.test.ts", repositoryTestTs(plugin.label.split(" ")[0] ?? plugin.id));
          write("test/global-setup.ts", globalSetupTs(name, db, plugin, ormContext));
        }
      }

      write(".env.example", envExample(name, orm, db));
      // Also written as .env so `npm run dev` and tools that read it work on a fresh clone
      // (Prisma's postinstall `prisma generate` fails without one).
      if (plugin) write(".env", envExample(name, orm, db));
      write(".gitignore", gitignore(orm));
      write("README.md", readmeMd(name, framework, structure, orm, db));
      write("ARCHITECTURE.md", architectureMd(name, framework, structure, orm));

      if (includeDocker) {
        write("Dockerfile", dockerfile(orm, db));
        write("docker-compose.yml", dockerCompose(name, orm, db));
      }
    },

    verify: (_config, outDir, context) => installAndTest(outDir, context),

    nextSteps: (config) => [`cd ${config.projectName}`, "npm install", "npm test", "npm run dev"],
  };
}

export const expressAdapter = makeNodeAdapter("express", "Express 5 (TypeScript + Prisma)");
export const fastifyAdapter = makeNodeAdapter("fastify", "Fastify 5 (TypeScript + Prisma)");
