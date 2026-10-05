import path from "node:path";
import type { ScaffoldConfig } from "../../config.js";
import { writeFile } from "../../utils/fsWrite.js";
import type { StackAdapter } from "../StackAdapter.js";
import { promptAxumAddons, resolveAxumAddons } from "./addons.js";
import { bootstrapWithCargo } from "./bootstrap.js";
import { installAndTest } from "./install.js";
import { pathsFor } from "./layout.js";
import { configRs, dbRs, errorRs, fallbackCargoToml, healthRs, libRs, mainRs, middlewareRs, stateRs } from "./templates/app.js";
import { entityRs, handlersRs, migrationSql, modRs, repositoryRs, serviceRs, sqlxRepositoryRs } from "./templates/feature.js";
import { architectureMd, dockerCompose, dockerfile, envExample, gitignore, readmeMd } from "./templates/project.js";
import { apiTestsRs } from "./templates/tests.js";
import type { AxumAddons } from "./types.js";

/**
 * The Axum StackAdapter. Thin by design: which files a structure needs and where they
 * go (layout.ts), with contents in templates/ and the "does it compile?" step in
 * install.ts.
 */
export const axumAdapter: StackAdapter = {
  id: "axum",
  label: "Axum (Rust + sqlx)",

  promptAddons: promptAxumAddons,
  resolveAddons: resolveAxumAddons,

  capabilities: { microservices: false, port: false },

  async generate(config: ScaffoldConfig, outDir: string): Promise<void> {
    const addons = config.addons as unknown as AxumAddons;
    const { structure, db, includeDocker } = addons;
    const paths = pathsFor(structure);
    const name = config.projectName;

    const write = (relPath: string, contents: string) => writeFile(path.join(outDir, relPath), contents);

    // cargo resolves current versions itself; a hand-written Cargo.toml (caret majors)
    // is the fallback when cargo is missing or the registry is unreachable.
    const usedCargo = addons.useCli ? await bootstrapWithCargo(outDir, name, db) : false;
    if (!usedCargo) write("Cargo.toml", fallbackCargoToml(name, db));

    write("src/main.rs", mainRs(name));
    write("src/lib.rs", libRs(paths));
    write("src/config.rs", configRs(name, db));
    write("src/error.rs", errorRs());
    write("src/db.rs", dbRs(db));
    write("src/state.rs", stateRs(paths));
    write("src/health.rs", healthRs());
    write("src/middleware.rs", middlewareRs());

    for (const mod of paths.modFiles) write(mod.file, modRs(mod.children));
    write(paths.entityFile, entityRs(structure));
    write(paths.repositoryFile, repositoryRs(paths));
    write(paths.sqlxFile, sqlxRepositoryRs(paths, structure, db));
    write(paths.serviceFile, serviceRs(paths));
    write(paths.handlersFile, handlersRs(paths, structure));
    write("migrations/0001_create_items.sql", migrationSql(db));

    if (config.includeTests) write("tests/api.rs", apiTestsRs(name, db));

    write(".env.example", envExample(name, db));
    write(".gitignore", gitignore(name, db));
    write("README.md", readmeMd(name, structure, db));
    write("ARCHITECTURE.md", architectureMd(name, structure, db));

    if (includeDocker) {
      write("Dockerfile", dockerfile(name));
      write("docker-compose.yml", dockerCompose(name, db));
    }
  },

  verify: (_config, outDir, context) => installAndTest(outDir, context),

  nextSteps: (config) => [`cd ${config.projectName}`, "cargo test", "cargo run"],
};
