import os from "node:os";
import path from "node:path";
import type { Challenge, Checker } from "./types.js";

/**
 * Returns the on-disk scratch project for one challenge, delegating its actual
 * layout to the language's Checker - a Cargo crate, an npm package, a Maven
 * module, whatever that language needs. Never touches the user's real scaffolded
 * project; everything lives under ~/.buildquick.
 */
export function ensureChallengeWorkspace(language: string, unitId: string, challenge: Challenge, checker: Checker): string {
  const workspaceDir = path.join(os.homedir(), ".buildquick", "learn", language, unitId, challenge.id);
  checker.scaffold(challenge, workspaceDir);
  return workspaceDir;
}
