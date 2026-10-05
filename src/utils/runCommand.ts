import { spawn } from "node:child_process";

export interface CommandResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  /** True when `signal` was aborted: the user cancelled, which is not the same as the command failing. */
  cancelled?: boolean;
}

export interface RunOptions {
  /** Kill the command after this long. Default 10 minutes. */
  timeoutMs?: number;
  /** Replaces the environment (e.g. to add npm stall timeouts). Default: inherit. */
  env?: NodeJS.ProcessEnv;
  /** Aborting kills the command and resolves with `cancelled: true`. */
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 600_000;

/**
 * Runs a command and captures its output instead of inheriting the terminal.
 *
 * Used for the post-generation "does this project actually work?" step, where the
 * output is something to report on rather than stream: a successful install is
 * hundreds of lines nobody wants, and a failure is worth showing in full.
 *
 * Never shells out through a shell, so a project name cannot be interpreted as
 * shell syntax.
 *
 * `options` may be a plain number (the timeout) - the original signature, kept so
 * existing callers did not have to change.
 */
export function runCommand(command: string, args: string[], cwd: string, options: number | RunOptions = {}): Promise<CommandResult> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, env, signal }: RunOptions = typeof options === "number" ? { timeoutMs: options } : options;

  return new Promise((resolve) => {
    // Already cancelled: do not even start the process.
    if (signal?.aborted) {
      resolve({ ok: false, code: null, stdout: "", stderr: "", cancelled: true });
      return;
    }

    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"], ...(env ? { env } : {}) });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let cancelled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const onAbort = () => {
      cancelled = true;
      // SIGTERM first: package managers clean up partial downloads when asked politely.
      child.kill("SIGTERM");
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });

    const finish = (result: CommandResult) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };

    // A missing binary is a normal outcome here (no python3 on PATH), not a crash:
    // the caller reports it as "couldn't verify" and the generated files still stand.
    child.on("error", (err) => finish({ ok: false, code: null, stdout, stderr: `${stderr}${err.message}` }));

    child.on("close", (code) =>
      finish({
        ok: code === 0 && !timedOut && !cancelled,
        code,
        stdout,
        stderr: timedOut ? `${stderr}\nTimed out after ${Math.round(timeoutMs / 1000)}s.` : stderr,
        ...(cancelled ? { cancelled: true } : {}),
      })
    );
  });
}

/** True when `command --version` runs at all - the cheap way to ask "is this tool installed?". */
export async function isAvailable(command: string, cwd = process.cwd()): Promise<boolean> {
  const result = await runCommand(command, ["--version"], cwd, 15_000);
  return result.code === 0;
}
