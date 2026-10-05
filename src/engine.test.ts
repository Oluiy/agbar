import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ScaffoldConfig } from "./config.js";
import { CancelledError, DestinationNotEmptyError, generateProject } from "./engine.js";
import type { RunContext, StackAdapter } from "./stacks/StackAdapter.js";
import type { VerifyResult } from "./stacks/verifyResult.js";
import type { Reporter } from "./ui/progress.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "buildquick-engine-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Records every call, so a test asserts on what the user would have been told. */
function recorder(): Reporter & { events: string[] } {
  const events: string[] = [];
  return {
    events,
    start: (m) => events.push(`start:${m}`),
    step: (l) => events.push(`step:${l}`),
    succeed: (m) => events.push(`succeed:${m}`),
    fail: (m) => events.push(`fail:${m}`),
  };
}

function config(addons: Record<string, unknown> = {}): ScaffoldConfig {
  return { projectName: "Demo", outputDirectory: root, includeTests: true, isMicroservice: false, serviceNames: [], httpPort: 8080, usesLlmApi: false, addons };
}

interface FakeOptions {
  generate?: (outDir: string, context: RunContext) => Promise<void> | void;
  verify?: (outDir: string, context: RunContext) => Promise<VerifyResult>;
  interactiveHandoff?: boolean;
}

function fakeAdapter({ generate, verify, interactiveHandoff }: FakeOptions = {}): StackAdapter {
  return {
    id: "fake",
    label: "Fake",
    ...(interactiveHandoff ? { interactiveHandoff } : {}),
    promptAddons: async () => ({}),
    resolveAddons: () => ({}),
    generate: async (_config, outDir, context) => {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(path.join(outDir, "file.txt"), "generated");
      await generate?.(outDir, context);
    },
    ...(verify ? { verify: (_config: ScaffoldConfig, outDir: string, context: RunContext) => verify(outDir, context) } : {}),
  };
}

const dest = () => path.join(root, "Demo");

describe("generateProject - the generation phase is all or nothing", () => {
  it("writes the project and reports where", async () => {
    const reporter = recorder();

    const result = await generateProject(config(), fakeAdapter(), { reporter });

    expect(readFileSync(path.join(result.outDir, "file.txt"), "utf-8")).toBe("generated");
    expect(reporter.events).toEqual(["start:Generating Fake project", `succeed:Generated at ${dest()}`]);
  });

  it("removes the half-written project when generation fails, and rethrows", async () => {
    const reporter = recorder();
    const adapter = fakeAdapter({
      generate: () => {
        throw new Error("template exploded");
      },
    });

    await expect(generateProject(config(), adapter, { reporter })).rejects.toThrow("template exploded");

    expect(existsSync(dest())).toBe(false);
    expect(reporter.events.at(-1)).toBe("fail:Generation failed.");
  });

  it("a cancel during generation leaves nothing behind and says so", async () => {
    const controller = new AbortController();
    const reporter = recorder();
    const adapter = fakeAdapter({ generate: () => controller.abort() });

    await expect(generateProject(config(), adapter, { reporter, signal: controller.signal })).rejects.toBeInstanceOf(CancelledError);

    expect(existsSync(dest())).toBe(false);
    expect(reporter.events.at(-1)).toBe("fail:Cancelled - nothing was created.");
  });

  it("refuses a destination that already has files, and does not touch them", async () => {
    mkdirSync(dest());
    writeFileSync(path.join(dest(), "mine.txt"), "precious");

    await expect(generateProject(config(), fakeAdapter(), { reporter: recorder() })).rejects.toBeInstanceOf(DestinationNotEmptyError);

    expect(readFileSync(path.join(dest(), "mine.txt"), "utf-8")).toBe("precious");
  });

  it("accepts an empty existing directory", async () => {
    mkdirSync(dest());

    await generateProject(config(), fakeAdapter(), { reporter: recorder() });

    expect(existsSync(path.join(dest(), "file.txt"))).toBe(true);
  });

  it("adapters that hand off to another program's prompts get no animation over them", async () => {
    const reporter = recorder();

    await generateProject(config(), fakeAdapter({ interactiveHandoff: true }), { reporter });

    expect(reporter.events).toEqual([]);
  });

  it("a handoff adapter that fails is cleaned up too", async () => {
    const adapter = fakeAdapter({
      interactiveHandoff: true,
      generate: () => {
        throw new Error("tool exited 1");
      },
    });

    await expect(generateProject(config(), adapter, { reporter: recorder() })).rejects.toThrow("tool exited 1");

    expect(existsSync(dest())).toBe(false);
  });
});

describe("generateProject - the verify phase never costs you the project", () => {
  const passing: VerifyResult = { installed: true, testsPassed: true, via: "npm", detail: "" };

  it("does not install unless asked - the default is fast", async () => {
    let called = false;
    const adapter = fakeAdapter({
      verify: async () => {
        called = true;
        return passing;
      },
    });

    const result = await generateProject(config({ install: false }), adapter, { reporter: recorder() });

    expect(called).toBe(false);
    expect(result.verify).toBeUndefined();
  });

  it("runs verify as its own named phase when asked, after the files exist", async () => {
    const reporter = recorder();
    const adapter = fakeAdapter({
      verify: async (outDir, context) => {
        expect(existsSync(path.join(outDir, "file.txt"))).toBe(true);
        context.step("installing packages");
        return passing;
      },
    });

    const result = await generateProject(config({ install: true }), adapter, { reporter });

    expect(result.verify).toEqual(passing);
    expect(reporter.events).toEqual([
      "start:Generating Fake project",
      `succeed:Generated at ${dest()}`,
      "start:Installing dependencies and running the tests (this can take a few minutes)",
      "step:installing packages",
      "succeed:Installed, and the tests pass",
    ]);
  });

  it("a stack with no verify step is simply generated", async () => {
    const result = await generateProject(config({ install: true }), fakeAdapter(), { reporter: recorder() });

    expect(result.verify).toBeUndefined();
  });

  it("a failed install keeps the project and reports the failure instead of throwing", async () => {
    const adapter = fakeAdapter({ verify: async () => ({ installed: false, via: "npm", detail: "ERESOLVE" }) });
    const reporter = recorder();

    const result = await generateProject(config({ install: true }), adapter, { reporter });

    expect(existsSync(path.join(dest(), "file.txt"))).toBe(true);
    expect(result.verify).toMatchObject({ installed: false, detail: "ERESOLVE" });
    expect(reporter.events.at(-1)).toBe("fail:Could not fully verify the project");
  });

  it("cancelling during the install keeps the project and reports cancelled, not failed", async () => {
    const controller = new AbortController();
    const adapter = fakeAdapter({
      verify: async () => {
        controller.abort();
        return { installed: false, detail: "" };
      },
    });
    const reporter = recorder();

    const result = await generateProject(config({ install: true }), adapter, { reporter, signal: controller.signal });

    expect(existsSync(path.join(dest(), "file.txt"))).toBe(true);
    expect(result.verify?.cancelled).toBe(true);
    expect(reporter.events.at(-1)).toBe("fail:Install cancelled - your project was kept.");
  });
});
