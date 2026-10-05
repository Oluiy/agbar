import path from "node:path";
import { isAvailable } from "../../utils/runCommand.js";
import { tail } from "../../utils/text.js";
import type { RunContext } from "../StackAdapter.js";
import { stepRunner } from "../stepRunner.js";
import type { VerifyResult } from "../verifyResult.js";

/**
 * Finds the newest interpreter on PATH. Any works, because requirements say
 * "django>=5.2" and pip chooses 5.2 on Python 3.10/3.11 or 6.x on 3.12+ - so the
 * generated project installs on whatever the machine has. Preferring newer ones
 * just means the user gets the current Django when they can.
 */
async function findPython(cwd: string): Promise<string | undefined> {
  for (const candidate of ["python3.14", "python3.13", "python3.12", "python3", "python"]) {
    if (await isAvailable(candidate, cwd)) return candidate;
  }
  return undefined;
}

/**
 * Creates a venv, installs the generated project, and runs Django's own test runner.
 * Never throws: generation already succeeded, so a failure is something to report.
 */
export async function installAndTest(projectDir: string, context: RunContext): Promise<VerifyResult> {
  const run = stepRunner(context, projectDir);
  const python = await findPython(projectDir);
  if (!python) return { detail: "No python3 on PATH, so the project could not be verified here." };

  const venv = await run("creating a virtual environment", python, ["-m", "venv", ".venv"]);
  if (!venv.ok) return { installed: false, via: "venv + pip", detail: tail(venv.stderr || venv.stdout) };

  const bin = path.join(projectDir, ".venv", "bin");
  const install = await run(
    "installing packages with pip",
    path.join(bin, "pip"),
    ["install", "-q", "--timeout", "120", "--retries", "5", "-r", "requirements.txt"],
    { timeoutMs: 900_000 }
  );
  if (!install.ok) return { installed: false, via: "venv + pip", detail: tail(install.stderr || install.stdout) };

  // `check` first so a settings error is reported as itself, not as a failed test.
  const check = await run("checking the Django settings", path.join(bin, "python"), ["manage.py", "check"], { timeoutMs: 120_000 });
  if (!check.ok) return { installed: true, testsPassed: false, via: "venv + pip", detail: `manage.py check failed:\n${tail(check.stderr || check.stdout)}` };

  const tests = await run("running the tests", path.join(bin, "python"), ["manage.py", "test"], { timeoutMs: 300_000 });
  // Django's runner prints its summary to stderr.
  return { installed: true, testsPassed: tests.ok, via: "venv + pip", detail: tail(tests.stderr || tests.stdout) };
}
