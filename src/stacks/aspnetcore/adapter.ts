import { execSync, spawn } from "node:child_process";
import type { ScaffoldConfig } from "../../config.js";
import type { StackAdapter } from "../StackAdapter.js";

function isBuildQuickPkgInstalled(): boolean {
  try {
    const output = execSync("dotnet tool list --global", { encoding: "utf-8" });
    return output.toLowerCase().includes("buildquickpkg");
  } catch {
    return false;
  }
}

/**
 * Thin wrapper around BuildQuickPkg (https://github.com/Oluiy/build-quick-aspnet),
 * not a reimplementation. Keeps BuildQuickPkg as the single source of truth for
 * ASP.NET Core generation instead of duplicating its C# template logic here.
 */
export const aspnetcoreAdapter: StackAdapter = {
  id: "aspnetcore",
  label: "ASP.NET Core (Clean Architecture, via BuildQuickPkg)",
  interactiveHandoff: true,
  supportsNonInteractive: false,

  resolveAddons(): Record<string, unknown> {
    return {};
  },

  async promptAddons() {
    // BuildQuickPkg is fully interactive and has no non-interactive flag surface
    // yet, so it re-asks its own architecture/deployment/port/EF-Core/JWT/Docker
    // questions directly once handed off to below. Nothing to collect here at
    // the Aggregator level. Known v1 limitation: the user answers a few of the
    // same-shaped questions (architecture pattern, port, ...) twice - once for
    // Aggregator's generic flow, once for BuildQuickPkg's own prompts. Fixing
    // that cleanly requires BuildQuickPkg to gain a non-interactive flag path
    // first, so Aggregator can pass its already-collected answers straight
    // through instead of handing off to a second interactive session.
    return {};
  },

  // BuildQuickPkg asks for its own architecture, port, tests and microservice choices.
  capabilities: { microservices: false, port: false, tests: false },

  nextSteps: (config) => [`cd ${config.projectName}`, "dotnet test", "dotnet run"],

  async generate(config: ScaffoldConfig): Promise<void> {
    if (!isBuildQuickPkgInstalled()) {
      throw new Error("BuildQuickPkg isn't installed. Run 'dotnet tool install --global BuildQuickPkg' first, then try again.");
    }

    await new Promise<void>((resolve, reject) => {
      const child = spawn("BuildQuickPkg", [config.projectName], {
        cwd: config.outputDirectory,
        stdio: "inherit",
      });

      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`BuildQuickPkg exited with code ${code}.`));
        }
      });
    });
  },
};
