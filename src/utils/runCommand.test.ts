import { describe, expect, it } from "vitest";
import { runCommand } from "./runCommand.js";

describe("runCommand", () => {
  it("captures output and reports success", async () => {
    const result = await runCommand("node", ["-e", "console.log('hi')"], process.cwd());

    expect(result).toMatchObject({ ok: true, code: 0 });
    expect(result.stdout.trim()).toBe("hi");
    expect(result.cancelled).toBeUndefined();
  });

  it("accepts the original numeric timeout argument", async () => {
    const result = await runCommand("node", ["-e", "setTimeout(() => {}, 5000)"], process.cwd(), 100);

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("Timed out");
  });

  it("a missing binary is a normal failure, not a crash", async () => {
    const result = await runCommand("definitely-not-a-real-binary", [], process.cwd());

    expect(result.ok).toBe(false);
    expect(result.cancelled).toBeUndefined();
  });

  it("aborting kills the command promptly and reports cancelled, not failed", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const running = runCommand("node", ["-e", "setTimeout(() => {}, 30000)"], process.cwd(), { signal: controller.signal });

    setTimeout(() => controller.abort(), 100);
    const result = await running;

    expect(result.cancelled).toBe(true);
    expect(result.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("an already-aborted signal never starts the process", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await runCommand("node", ["-e", "require('fs').writeFileSync('/tmp/should-not-exist-bq', 'x')"], process.cwd(), {
      signal: controller.signal,
    });

    expect(result.cancelled).toBe(true);
    expect(result.code).toBeNull();
  });
});
