import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * The composition root, exercised as a real process. Everything else is tested against
 * functions; this is the only place that proves the wiring - exit codes, what reaches the
 * user when there is no terminal, and that a scripted run needs none.
 *
 * Runs src/cli.ts through tsx rather than dist/, because the test step runs before the
 * build step in CI.
 */
const root = fileURLToPath(new URL("..", import.meta.url));

let scratch: string;
beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), "agbar-cli-test-"));
});
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** stdin is closed and stdout is a pipe, so neither is a TTY - exactly CI, or a script. */
function run(args: string[]) {
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    // A scratch HOME so no run can touch real lesson progress; NO_COLOR keeps assertions plain.
    env: { ...process.env, HOME: scratch, NO_COLOR: "1" },
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

function scriptedConfig(stack: string): string {
  const file = path.join(scratch, "config.json");
  writeFileSync(file, JSON.stringify({ stack, outputDirectory: scratch }));
  return file;
}

describe("running without a terminal", () => {
  it("does not start the questions, and says how to script it instead", () => {
    const { status, out } = run([]);

    expect(status).toBe(1);
    expect(out).toContain("interactive terminal");
    expect(out).toContain("--yes");
    // The raw error this replaced - a libuv message nobody can act on.
    expect(out).not.toContain("uv_tty_init");
  });

  it("the same when a name is given but nothing says to skip the questions", () => {
    const { status, out } = run(["Demo"]);

    expect(status).toBe(1);
    expect(out).toContain("interactive terminal");
  });

  it("a scripted run needs no terminal at all", () => {
    const { status } = run(["Demo", "--yes", "--config", scriptedConfig("fastapi")]);

    expect(status).toBe(0);
    expect(existsSync(path.join(scratch, "Demo", "pyproject.toml"))).toBe(true);
  });
});

describe("a scripted run fails loudly", () => {
  it("on a stack that does not exist, with a non-zero exit", () => {
    const { status, out } = run(["Demo", "--yes", "--stack", "nope"]);

    expect(status).toBe(1);
    expect(out).toContain("Unknown stack 'nope'");
  });

  it("rather than merge into a destination that already has files", () => {
    const config = scriptedConfig("fastapi");
    expect(run(["Demo", "--yes", "--config", config]).status).toBe(0);

    const { status, out } = run(["Demo", "--yes", "--config", config]);

    expect(status).toBe(1);
    expect(out).toContain("already exists and is not empty");
  });
});
