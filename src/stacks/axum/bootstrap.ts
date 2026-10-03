import { rmSync } from "node:fs";
import path from "node:path";
import { isAvailable, runCommand } from "../../utils/runCommand.js";
import { toKebab } from "./layout.js";
import type { AxumDb } from "./types.js";

/**
 * Creates the crate with cargo itself: `cargo new` for the skeleton, then `cargo add`
 * for every dependency. `cargo add` resolves the newest compatible release from the
 * registry and writes it into Cargo.toml, so no version in this repo can go stale -
 * and it rejects a feature name that does not exist, which catches a wrong feature at
 * generate time instead of at the first build.
 *
 * Returns false (never throws) when cargo is missing or any step fails, so the adapter
 * can fall back to a hand-written Cargo.toml and still produce a working project.
 */

/** [crate, ...cargo-add flags]. One entry per `cargo add` call. */
function dependencyCalls(db: AxumDb): string[][] {
  return [
    ["axum"],
    ["tokio", "--features", "rt-multi-thread,macros,signal,net"],
    ["serde", "--features", "derive"],
    ["serde_json"],
    ["tracing"],
    ["tracing-subscriber", "--features", "env-filter"],
    ["tower-http", "--features", "trace,timeout,limit"],
    // default-features off: sqlx's defaults pull in the "any" driver and more than a
    // service using one database needs.
    ["sqlx", "--no-default-features", "--features", `runtime-tokio,${db},migrate,macros`],
    // default-features off: its defaults include tonic, a gRPC stack nothing here uses.
    ["tower_governor", "--no-default-features", "--features", "axum"],
    ["--dev", "tower", "--features", "util"],
    ["--dev", "http-body-util"],
  ];
}

export async function bootstrapWithCargo(projectDir: string, projectName: string, db: AxumDb): Promise<boolean> {
  if (!(await isAvailable("cargo", path.dirname(projectDir)))) return false;

  // --vcs none: scaffolding should not decide the user's version control.
  const created = await runCommand("cargo", ["new", "--bin", "--vcs", "none", "--name", toKebab(projectName), projectDir], path.dirname(projectDir), 120_000);
  if (!created.ok) return false;

  for (const call of dependencyCalls(db)) {
    const added = await runCommand("cargo", ["add", ...call], projectDir, 180_000);
    if (!added.ok) return false;
  }

  // cargo new writes a hello-world main.rs that this adapter replaces.
  rmSync(path.join(projectDir, "src", "main.rs"), { force: true });
  return true;
}
