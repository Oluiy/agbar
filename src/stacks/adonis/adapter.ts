import { confirm, isCancel } from "@clack/prompts";
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { ScaffoldConfig } from "../../config.js";
import { runCommand } from "../../utils/runCommand.js";
import { tail } from "../../utils/text.js";
import type { GenerateResult, StackAdapter } from "../StackAdapter.js";
import type { VerifyResult } from "../verifyResult.js";
import { applyOverlay } from "./overlay.js";

/**
 * AdonisJS 7. Unlike the other adapters there is no hand-written fallback: the project
 * *is* the official `api` starter kit (`npm create adonisjs -- --kit=api`), which ships
 * auth, conventions and a tool-version set the Adonis team maintains. buildquick then adds
 * @adonisjs/limiter with Adonis's own `node ace add`, and overlays the example feature,
 * probes and tests (overlay.ts). With no network the kit cannot be fetched, so generation
 * fails with a clear message rather than producing a hand-rolled imitation.
 *
 * SQLite only, the kit's default; PostgreSQL is a `config/database.ts` change documented
 * by Adonis rather than something this adapter rewrites.
 */

interface AdonisAddons {
  install: boolean;
}

/** npm, told to give up on a stalled transfer and retry instead of hanging. */
const NPM_ENV = {
  ...process.env,
  npm_config_fetch_timeout: "30000",
  npm_config_fetch_retries: "8",
  npm_config_fetch_retry_mintimeout: "1000",
  npm_config_fetch_retry_maxtimeout: "15000",
};

/** @adonisjs/core 7 requires Node 24+; check first so the failure names the real cause. */
function assertNodeVersion(): void {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 24) {
    throw new Error(
      `AdonisJS 7 needs Node 24 or newer; this is Node ${process.versions.node}. Install Node 24 (e.g. "nvm install 24") and run buildquick again.`
    );
  }
}

async function run(command: string, args: string[], cwd: string, timeoutMs: number, step: string): Promise<void> {
  const result = await runCommand(command, args, cwd, timeoutMs, NPM_ENV);
  if (!result.ok) {
    throw new Error(`${step} failed:\n${tail(result.stderr || result.stdout)}`);
  }
}

async function verify(projectDir: string): Promise<VerifyResult> {
  const typecheck = await runCommand("npx", ["tsc", "--noEmit"], projectDir, 300_000, NPM_ENV);
  if (!typecheck.ok) return { installed: true, testsPassed: false, via: "npm", detail: `typecheck failed:\n${tail(typecheck.stdout || typecheck.stderr)}` };
  const tests = await runCommand("node", ["ace", "test"], projectDir, 600_000, NPM_ENV);
  return { installed: true, testsPassed: tests.ok, via: "npm", detail: tail(tests.stdout || tests.stderr) };
}

export const adonisAdapter: StackAdapter = {
  id: "adonis",
  label: "AdonisJS 7 (official api starter kit + Lucid)",

  async promptAddons() {
    const install = await confirm({ message: "Typecheck and run the tests after generating?", initialValue: true });
    if (isCancel(install)) process.exit(1);
    return { install } satisfies AdonisAddons;
  },

  resolveAddons(raw) {
    return { install: raw.install === true } satisfies AdonisAddons;
  },

  async generate(config: ScaffoldConfig, outDir: string): Promise<GenerateResult> {
    assertNodeVersion();
    const addons = config.addons as unknown as AdonisAddons;
    if (existsSync(outDir)) {
      throw new Error(`${outDir} already exists. The Adonis starter kit needs an empty destination.`);
    }

    // The official scaffolder: downloads the kit, installs it, and generates APP_KEY.
    await run(
      "npm",
      ["create", "adonisjs@latest", path.basename(outDir), "--", "--kit=api", "--pkg=npm", "--skip-migrations"],
      path.dirname(outDir),
      1_800_000,
      "npm create adonisjs"
    );

    // If the scaffolder's "prepare" step did not run, do what it would have done.
    if (!existsSync(path.join(outDir, ".env"))) {
      copyFileSync(path.join(outDir, ".env.example"), path.join(outDir, ".env"));
      await run("node", ["ace", "generate:key"], outDir, 120_000, "node ace generate:key");
    }

    // Rate limiting the Adonis way. Its configure step only offers the database and redis
    // stores; database survives restarts and is shared across instances.
    await run("node", ["ace", "add", "@adonisjs/limiter", "--store=database"], outDir, 1_200_000, "node ace add @adonisjs/limiter");

    applyOverlay(outDir, config.projectName, config.includeTests);

    return { verify: addons.install && config.includeTests ? await verify(outDir) : undefined };
  },
};
