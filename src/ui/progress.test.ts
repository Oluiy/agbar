import { describe, expect, it } from "vitest";
import { createTerminalReporter, fitToWidth, formatElapsed } from "./progress.js";

/** A stand-in stream: records writes and says whether it is a terminal. */
function fakeStream(isTTY: boolean) {
  const writes: string[] = [];
  const stream = { isTTY, write: (s: string) => (writes.push(s), true) } as unknown as NodeJS.WriteStream;
  return { stream, text: () => writes.join("").replace(/\x1b\[[0-9;]*[A-Za-z]/g, "") };
}

describe("formatElapsed", () => {
  it.each([
    [0, "0:00"],
    [9, "0:09"],
    [75, "1:15"],
    [224, "3:44"],
    [-5, "0:00"],
  ])("%s seconds -> %s", (seconds, text) => {
    expect(formatElapsed(seconds)).toBe(text);
  });
});

describe("fitToWidth", () => {
  it("leaves short text alone and cuts long text to exactly the width", () => {
    expect(fitToWidth("short", 20)).toBe("short");
    expect(fitToWidth("a very long installing message", 10)).toBe("a very lo…");
    expect(fitToWidth("abc", 0)).toBe("…");
  });
});

describe("createTerminalReporter on a narrow terminal", () => {
  it("never draws a line wider than the terminal, so redraws cannot stack up", async () => {
    const writes: string[] = [];
    const stream = { isTTY: true, columns: 40, write: (s: string) => (writes.push(s), true) } as unknown as NodeJS.WriteStream;
    const reporter = createTerminalReporter({ stream, now: () => 0, tickMs: 5 });

    reporter.start("Installing dependencies and running the tests (this can take a few minutes)");
    reporter.step("installing packages with pip (install uv to make this much faster)");
    await new Promise((resolve) => setTimeout(resolve, 30));
    reporter.fail("stop");

    const frames = writes.filter((w) => w.startsWith("\r\x1b[2K") && w.length > 4).map((w) => w.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace("\r", ""));
    expect(frames.length).toBeGreaterThan(1);
    for (const frame of frames) expect(frame.length).toBeLessThan(40);
  });
});

describe("createTerminalReporter without a terminal (CI, a pipe)", () => {
  it("prints one plain line per step - no redrawing, no escape codes", () => {
    const { stream, text } = fakeStream(false);
    const reporter = createTerminalReporter({ stream, now: () => 0 });

    reporter.start("Installing");
    reporter.step("creating virtualenv");
    reporter.step("installing packages");
    reporter.succeed("Done");

    const output = text();
    expect(output).toContain("Installing\n");
    expect(output).toContain("  creating virtualenv\n");
    expect(output).toContain("  installing packages\n");
    expect(output).toMatch(/Done \(0:00\)\n/);
    expect(output).not.toContain("\r");
  });

  it("shows elapsed time on success, so a slow install is accounted for", () => {
    const { stream, text } = fakeStream(false);
    let clock = 0;
    const reporter = createTerminalReporter({ stream, now: () => clock });

    reporter.start("Installing");
    clock = 224_000;
    reporter.succeed("Installed");

    expect(text()).toContain("Installed (3:44)");
  });

  it("failure is marked and carries no stale clock", () => {
    const { stream, text } = fakeStream(false);
    const reporter = createTerminalReporter({ stream, now: () => 0 });

    reporter.start("Installing");
    reporter.fail("Install cancelled");

    expect(text()).toContain("✖ Install cancelled");
  });
});

describe("createTerminalReporter on a terminal", () => {
  it("animates with an elapsed clock and clears its line when finished", async () => {
    const { stream, text } = fakeStream(true);
    const reporter = createTerminalReporter({ stream, now: () => 0, tickMs: 10 });

    reporter.start("Installing");
    reporter.step("installing packages");
    await new Promise((resolve) => setTimeout(resolve, 60));
    reporter.succeed("Installed");

    const output = text();
    expect(output).toContain("Installing - installing packages");
    expect(output).toContain("(0:00)");
    expect(output.trimEnd().endsWith("Installed (0:00)")).toBe(true);
  });
});
