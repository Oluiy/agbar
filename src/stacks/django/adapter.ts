import path from "node:path";
import type { ScaffoldConfig } from "../../config.js";
import { ensureDir, writeFile } from "../../utils/fsWrite.js";
import { isAvailable, runCommand } from "../../utils/runCommand.js";
import type { GenerateResult, StackAdapter } from "../StackAdapter.js";
import { promptDjangoAddons, resolveDjangoAddons } from "./addons.js";
import { installAndTest } from "./install.js";
import {
  adminPy,
  appConfigPy,
  coreUrlsPy,
  coreViewsPy,
  initialMigrationPy,
  itemsUrlsPy,
  modelsPy,
  paginationPy,
  selectorsPy,
  serializersPy,
  servicesPy,
  testCorePy,
  testItemsPy,
  viewsPy,
} from "./templates/apps.js";
import { asgiPy, managePy, settingsPy, urlsPy, wsgiPy } from "./templates/config.js";
import { architectureMd, dockerCompose, dockerfile, envExample, gitignore, readmeMd, requirementsTxt } from "./templates/project.js";
import type { DjangoAddons } from "./types.js";

/**
 * The Django StackAdapter. Thin by design: which files a structure needs, with the
 * contents in templates/ and the "does it actually work?" step in install.ts.
 */

/**
 * Runs `django-admin startproject` when Django is already on PATH, so manage.py and
 * the wsgi/asgi entrypoints are the framework's own for whatever version the user
 * has. buildquick then overwrites settings.py and urls.py - the CLI's settings
 * hardcode a SECRET_KEY and DEBUG=True, which is exactly what this scaffold exists
 * not to ship - so the delegation covers the stable boilerplate, not the policy.
 *
 * Returns false when Django is not installed (the common case: it normally lives in
 * the project's venv, created later), and the adapter writes those files itself.
 */
async function bootstrapWithDjangoAdmin(projectDir: string): Promise<boolean> {
  if (!(await isAvailable("django-admin", projectDir))) return false;
  ensureDir(projectDir);
  const result = await runCommand("django-admin", ["startproject", "config", "."], projectDir, 120_000);
  return result.ok;
}

export const djangoAdapter: StackAdapter = {
  id: "django",
  label: "Django (Python + Django REST Framework)",

  promptAddons: promptDjangoAddons,
  resolveAddons: resolveDjangoAddons,

  async generate(config: ScaffoldConfig, outDir: string): Promise<GenerateResult> {
    const addons = config.addons as unknown as DjangoAddons;
    const { structure, db, includeDocker } = addons;
    const name = config.projectName;

    const write = (relPath: string, contents: string) => writeFile(path.join(outDir, relPath), contents);

    const usedCli = addons.useCli ? await bootstrapWithDjangoAdmin(outDir) : false;
    if (!usedCli) {
      write("manage.py", managePy());
      write("config/__init__.py", "");
      write("config/wsgi.py", wsgiPy());
      write("config/asgi.py", asgiPy());
    }
    // Always ours, even after the CLI ran: its settings ship a hardcoded
    // SECRET_KEY and DEBUG=True.
    write("config/settings.py", settingsPy(name, db));
    write("config/urls.py", urlsPy());
    // The CLI's manage.py lacks the DEBUG default that lets a fresh clone run.
    write("manage.py", managePy());

    write("apps/__init__.py", "");
    write("apps/core/__init__.py", "");
    write("apps/core/apps.py", appConfigPy("core"));
    write("apps/core/pagination.py", paginationPy());
    write("apps/core/views.py", coreViewsPy());
    write("apps/core/urls.py", coreUrlsPy());

    write("apps/items/__init__.py", "");
    write("apps/items/apps.py", appConfigPy("items"));
    write("apps/items/models.py", modelsPy());
    write("apps/items/admin.py", adminPy());
    write("apps/items/serializers.py", serializersPy());
    write("apps/items/views.py", viewsPy(structure));
    write("apps/items/urls.py", itemsUrlsPy());
    write("apps/items/migrations/__init__.py", "");
    write("apps/items/migrations/0001_initial.py", initialMigrationPy());
    if (structure === "service-layer") {
      write("apps/items/services.py", servicesPy());
      write("apps/items/selectors.py", selectorsPy());
    }

    if (config.includeTests) {
      write("apps/core/tests.py", testCorePy());
      write("apps/items/tests.py", testItemsPy());
    }

    write("requirements.txt", requirementsTxt(db, includeDocker));
    write(".env.example", envExample(name, db));
    write(".gitignore", gitignore(name, db));
    write("README.md", readmeMd(name, structure, db));
    write("ARCHITECTURE.md", architectureMd(name, structure));

    if (includeDocker) {
      write("Dockerfile", dockerfile());
      write("docker-compose.yml", dockerCompose(name, db));
    }

    return { verify: addons.install ? await installAndTest(outDir) : undefined };
  },
};
