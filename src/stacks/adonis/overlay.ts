import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { writeFile } from "../../utils/fsWrite.js";
import {
  ITEMS_MIGRATION,
  architectureMd,
  healthController,
  healthSpec,
  itemModel,
  itemValidator,
  itemsController,
  itemsMigration,
  itemsSpec,
  limiterTs,
  routesAppendix,
} from "./templates.js";

/**
 * Replaces exactly one occurrence of `find` in a kit file, or throws naming the file.
 *
 * The kit is upstream code that changes between releases. Failing loudly when an anchor
 * has moved is the point: a silent no-op here would ship a project whose tests touch the
 * development database, or whose limiter reads a variable nobody declared.
 */
function patch(projectDir: string, relPath: string, find: string, replace: string): void {
  const file = path.join(projectDir, relPath);
  const text = readFileSync(file, "utf-8");
  const count = text.split(find).length - 1;
  if (count !== 1) {
    throw new Error(
      `AdonisJS starter kit changed: expected exactly one "${find}" in ${relPath}, found ${count}. ` + "agbar's overlay needs updating for this kit version."
    );
  }
  writeFileSync(file, text.replace(find, replace), "utf-8");
}

/** Adds agbar's layer to a project created from the official `api` kit, with @adonisjs/limiter already added. */
export function applyOverlay(projectDir: string, projectName: string, includeTests: boolean): void {
  const write = (relPath: string, contents: string) => writeFile(path.join(projectDir, relPath), contents);

  write(ITEMS_MIGRATION, itemsMigration());
  write("app/models/item.ts", itemModel());
  write("app/validators/item.ts", itemValidator());
  write("app/controllers/items_controller.ts", itemsController());
  write("app/controllers/health_controller.ts", healthController());
  write("start/limiter.ts", limiterTs());
  appendFileSync(path.join(projectDir, "start/routes.ts"), routesAppendix(), "utf-8");

  // The limit is configurable, so it has to be declared in the validated env schema.
  patch(
    projectDir,
    "start/env.ts",
    "LIMITER_STORE: Env.schema.enum(['database', 'memory'] as const)",
    "LIMITER_STORE: Env.schema.enum(['database', 'memory'] as const),\n  RATE_LIMIT_REQUESTS: Env.schema.number.optional()"
  );

  // The kit points development and tests at the same SQLite file, so a test run would write
  // into (and migrate, and roll back) the developer's own database.
  patch(projectDir, "config/database.ts", "app.tmpPath('db.sqlite3')", "app.tmpPath(app.inTest ? 'test.sqlite3' : 'db.sqlite3')");

  for (const envFile of [".env", ".env.example"]) {
    if (existsSync(path.join(projectDir, envFile))) {
      appendFileSync(path.join(projectDir, envFile), "\n# Requests per client per minute on the API (start/limiter.ts)\nRATE_LIMIT_REQUESTS=100\n", "utf-8");
    }
  }

  if (includeTests) {
    // Tests: the in-memory limiter store (no rate_limits table needed) and a low limit, so
    // the throttling test is quick.
    appendFileSync(path.join(projectDir, ".env.test"), "LIMITER_STORE=memory\nRATE_LIMIT_REQUESTS=5\n", "utf-8");
    // Migrate the (test) database before the suite; the returned cleanup rolls it back.
    patch(projectDir, "tests/bootstrap.ts", "  setup: [],", "  setup: [() => testUtils.db().migrate()],");
    write("tests/functional/health.spec.ts", healthSpec());
    write("tests/functional/items.spec.ts", itemsSpec());
  }

  write("ARCHITECTURE.md", architectureMd(projectName));
}
