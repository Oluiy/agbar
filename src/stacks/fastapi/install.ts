import path from "node:path";
import { isAvailable, runCommand } from "../../utils/runCommand.js";
import { tail } from "../../utils/text.js";
import type { VerifyResult } from "../verifyResult.js";

/**
 * Installs the generated project's dependencies and runs its tests.
 *
 * This is the step that makes "a working project" a fact instead of a claim: the
 * file tree can look perfect and still not import. Prefers uv when present (it is
 * far faster and resolves the lock file), and falls back to the stdlib venv + pip,
 * which exists wherever Python does.
 *
 * Never throws: generation already succeeded by this point, so a failure here is
 * something to report, not a reason to discard the project.
 */
export async function installAndTest(projectDir: string): Promise<VerifyResult> {
  if (await isAvailable("uv", projectDir)) {
    const sync = await runCommand("uv", ["sync", "--extra", "dev"], projectDir);
    if (!sync.ok) return { installed: false, via: "uv", detail: tail(sync.stderr || sync.stdout) };

    const tests = await runCommand("uv", ["run", "pytest"], projectDir);
    return { installed: true, testsPassed: tests.ok, via: "uv", detail: tail(tests.stdout || tests.stderr) };
  }

  const python = (await isAvailable("python3", projectDir)) ? "python3" : (await isAvailable("python", projectDir)) ? "python" : undefined;
  if (!python) {
    return { detail: "Neither uv nor python3 is on PATH, so the project could not be verified here." };
  }

  const venv = await runCommand(python, ["-m", "venv", ".venv"], projectDir);
  if (!venv.ok) return { installed: false, via: "venv + pip", detail: tail(venv.stderr || venv.stdout) };

  // The venv's own binaries, so this works whether or not the shell is activated.
  const bin = path.join(projectDir, ".venv", "bin");
  const pip = path.join(bin, "pip");

  const install = await runCommand(pip, ["install", "-q", "-r", "requirements-dev.txt"], projectDir);
  if (!install.ok) return { installed: false, via: "venv + pip", detail: tail(install.stderr || install.stdout) };

  const tests = await runCommand(path.join(bin, "pytest"), [], projectDir);
  return { installed: true, testsPassed: tests.ok, via: "venv + pip", detail: tail(tests.stdout || tests.stderr) };
}

/** The last few lines are where the useful part of pip's and pytest's output lives. */
