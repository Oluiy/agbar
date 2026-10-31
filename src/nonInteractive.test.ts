import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveNonInteractive } from "./nonInteractive.js";
import type { StackAdapter } from "./stacks/StackAdapter.js";

// Minimal fake adapters, independent of the real springboot/aspnetcore ones -
// this file tests resolveNonInteractive's own logic (merging, precedence,
// validation), not any particular stack's addon shape.
const fakeAdapter: StackAdapter = {
  id: "fake",
  label: "Fake Stack",
  promptAddons: async () => ({}),
  resolveAddons: (raw) => {
    const size = (raw.size as string | undefined) ?? "small";
    if (!["small", "large"].includes(size)) {
      throw new Error(`Invalid size '${size}'.`);
    }
    return { size };
  },
  generate: async () => {},
};

const noninteractiveUnsupportedAdapter: StackAdapter = {
  id: "handoff-only",
  label: "Handoff Only Stack",
  supportsNonInteractive: false,
  promptAddons: async () => ({}),
  resolveAddons: () => ({}),
  generate: async () => {},
};

const stacks = [fakeAdapter, noninteractiveUnsupportedAdapter];

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "agbar-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeConfig(contents: unknown): string {
  const p = path.join(tmpDir, "config.json");
  writeFileSync(p, JSON.stringify(contents), "utf-8");
  return p;
}

describe("resolveNonInteractive", () => {
  it("requires a project name", () => {
    expect(() => resolveNonInteractive(stacks, { stack: "fake" })).toThrow(/project name is required/);
  });

  it("rejects an invalid project name", () => {
    expect(() => resolveNonInteractive(stacks, { stack: "fake" }, "bad name")).toThrow(/isn't a valid project name/);
  });

  it("requires a stack", () => {
    expect(() => resolveNonInteractive(stacks, {}, "MyApp")).toThrow(/stack is required/);
  });

  it("rejects an unknown stack", () => {
    expect(() => resolveNonInteractive(stacks, { stack: "nope" }, "MyApp")).toThrow(/Unknown stack 'nope'/);
  });

  it("refuses an adapter that doesn't support non-interactive mode", () => {
    expect(() => resolveNonInteractive(stacks, { stack: "handoff-only" }, "MyApp")).toThrow(/can't run non-interactively yet/);
  });

  it("defaults includeTests to true and httpPort to 8080 when nothing overrides them", () => {
    const { config } = resolveNonInteractive(stacks, { stack: "fake" }, "MyApp");
    expect(config.includeTests).toBe(true);
    expect(config.httpPort).toBe(8080);
    expect(config.usesLlmApi).toBe(false);
  });

  it("requires at least one service name in microservice mode", () => {
    expect(() => resolveNonInteractive(stacks, { stack: "fake", microservice: true }, "MyApp")).toThrow(/needs at least one service name/);
  });

  it("passing --services implies microservice mode without needing the flag too", () => {
    const { config } = resolveNonInteractive(stacks, { stack: "fake", services: "Orders,Payments" }, "MyApp");
    expect(config.isMicroservice).toBe(true);
    expect(config.serviceNames).toEqual(["Orders", "Payments"]);
  });

  it("rejects an invalid service name", () => {
    expect(() => resolveNonInteractive(stacks, { stack: "fake", services: "Orders,1Bad" }, "MyApp")).toThrow(/'1Bad' isn't valid/);
  });

  it("rejects a non-positive port", () => {
    expect(() => resolveNonInteractive(stacks, { stack: "fake", port: "0" }, "MyApp")).toThrow(/Invalid port/);
  });

  it("propagates an adapter's own validation error from resolveAddons instead of swallowing it", () => {
    const configPath = writeConfig({ addons: { size: "huge" } });
    expect(() => resolveNonInteractive(stacks, { stack: "fake", config: configPath }, "MyApp")).toThrow(/Invalid size 'huge'/);
  });

  it("reads projectName and stack from --config when not passed as flags/args", () => {
    const configPath = writeConfig({ projectName: "FromFile", stack: "fake" });
    const { config, adapter } = resolveNonInteractive(stacks, { config: configPath });
    expect(config.projectName).toBe("FromFile");
    expect(adapter.id).toBe("fake");
  });

  it("throws a clear error for a missing config file", () => {
    expect(() => resolveNonInteractive(stacks, { config: "/no/such/file.json", stack: "fake" }, "MyApp")).toThrow(/Couldn't read config file/);
  });

  it("throws a clear error for invalid JSON in the config file", () => {
    const p = path.join(tmpDir, "bad.json");
    writeFileSync(p, "{ not valid json", "utf-8");
    expect(() => resolveNonInteractive(stacks, { config: p, stack: "fake" }, "MyApp")).toThrow(/isn't valid JSON/);
  });

  it("CLI flags override the same setting from --config", () => {
    const configPath = writeConfig({ stack: "fake", addons: { size: "large" } });
    const { config } = resolveNonInteractive(stacks, { config: configPath, stack: "fake" }, "MyApp");
    // No flag override for "size" here - should keep the file's value.
    expect(config.addons).toEqual({ size: "large" });
  });

  it("a project name argument overrides --config's projectName", () => {
    const configPath = writeConfig({ projectName: "FromFile", stack: "fake" });
    const { config } = resolveNonInteractive(stacks, { config: configPath }, "FromArg");
    expect(config.projectName).toBe("FromArg");
  });
});

describe("resolveNonInteractive - settings the stack does not use fail loudly", () => {
  const simple: StackAdapter = { ...fakeAdapter, id: "simple", label: "Simple Stack", capabilities: { microservices: false, port: false } };
  const withSimple = [simple, fakeAdapter];

  it.each([
    [{ port: "9000" }, /--port has no effect on Simple Stack/],
    [{ microservice: true }, /--microservice has no effect/],
    [{ services: "a,b" }, /--services has no effect/],
  ])("rejects %j", (flags, message) => {
    expect(() => resolveNonInteractive(withSimple, { stack: "simple", ...flags }, "MyApp")).toThrow(message);
  });

  it("rejects the same settings from a --config file", () => {
    const configPath = writeConfig({ stack: "simple", httpPort: 9000 });
    expect(() => resolveNonInteractive(withSimple, { config: configPath }, "MyApp")).toThrow(/"httpPort" has no effect/);
  });

  it("still accepts them for a stack that uses them", () => {
    const { config } = resolveNonInteractive(withSimple, { stack: "fake", port: "9000" }, "MyApp");
    expect(config.httpPort).toBe(9000);
  });

  it("a plain run with none of them is unaffected", () => {
    expect(() => resolveNonInteractive(withSimple, { stack: "simple" }, "MyApp")).not.toThrow();
  });
});
