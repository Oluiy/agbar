import { spawn } from "node:child_process";

export interface CommandResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs a command and captures its output instead of inheriting the terminal.
 *
 * Used for the post-generation "does this project actually work?" step, where the
 * output is something to report on rather than stream: a successful install is
 * hundreds of lines nobody wants, and a failure is worth showing in full.
 *
 * Never shells out through a shell, so a project name cannot be interpreted as
 * shell syntax.
 */
export function runCommand(command: string, args: string[], cwd: string, timeoutMs = 600_000, env?: NodeJS.ProcessEnv): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"], ...(env ? { env } : {}) });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });

    // A missing binary is a normal outcome here (no python3 on PATH), not a crash:
    // the caller reports it as "couldn't verify" and the generated files still stand.
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, stdout, stderr: `${stderr}${err.message}` });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        code,
        stdout,
        stderr: timedOut ? `${stderr}\nTimed out after ${Math.round(timeoutMs / 1000)}s.` : stderr,
      });
    });
  });
}

/** True when `command --version` runs at all - the cheap way to ask "is this tool installed?". */
export async function isAvailable(command: string, cwd = process.cwd()): Promise<boolean> {
  const result = await runCommand(command, ["--version"], cwd, 15_000);
  return result.code === 0;
}
