import { describe, expect, it } from "vitest";
import { resolveNonInteractive } from "./nonInteractive.js";
import { describeDefaults, quickConfig, supportsQuickDefaults } from "./quickConfig.js";
import { expressAdapter } from "./stacks/node/adapter.js";
import { aspnetcoreAdapter } from "./stacks/aspnetcore/adapter.js";
import { djangoAdapter } from "./stacks/django/adapter.js";
import { fastapiAdapter } from "./stacks/fastapi/adapter.js";
import { springbootAdapter } from "./stacks/springboot/adapter.js";
import { capabilitiesOf } from "./stacks/StackAdapter.js";

describe("quickConfig", () => {
  it("uses the stack's own resolved defaults and never installs", () => {
    const config = quickConfig(fastapiAdapter, "Know", "/tmp");

    expect(config.addons).toMatchObject(fastapiAdapter.resolveAddons({}));
    expect(config.addons.install).toBe(false);
    expect(config).toMatchObject({ projectName: "Know", outputDirectory: "/tmp", includeTests: true, isMicroservice: false });
  });

  it("is not offered for a stack that hands off to another program's prompts", () => {
    expect(supportsQuickDefaults(aspnetcoreAdapter)).toBe(false);
    expect(supportsQuickDefaults(fastapiAdapter)).toBe(true);
  });
});

describe("--db and --orm reach every stack, not only Spring Boot", () => {
  const all = [fastapiAdapter, djangoAdapter, expressAdapter, springbootAdapter];

  it("--db postgres is honoured by FastAPI, Django and Express", () => {
    for (const adapter of [fastapiAdapter, djangoAdapter, expressAdapter]) {
      const { config } = resolveNonInteractive(all, { stack: adapter.id, db: "postgres" }, "App");
      expect(config.addons.db, adapter.id).toBe("postgres");
    }
  });

  it("a value a stack cannot do is rejected by name, not ignored", () => {
    expect(() => resolveNonInteractive(all, { stack: "fastapi", db: "mysql" }, "App")).toThrow(/Invalid database 'mysql'/);
  });

  it("--orm selects the Node ORM", () => {
    const { config } = resolveNonInteractive(all, { stack: "express", orm: "drizzle" }, "App");
    expect(config.addons.orm).toBe("drizzle");
  });
});

describe("describeDefaults", () => {
  it("names the choices the shortcut makes, so none is hidden", () => {
    expect(describeDefaults(expressAdapter)).toBe("structure: layered, orm: prisma, db: sqlite");
  });
});

describe("stack capabilities - only ask what a stack uses", () => {
  it("only Spring Boot uses a port and microservices", () => {
    expect(capabilitiesOf(springbootAdapter)).toMatchObject({ port: true, microservices: true });
    expect(capabilitiesOf(fastapiAdapter)).toMatchObject({ port: false, microservices: false });
    expect(capabilitiesOf(djangoAdapter)).toMatchObject({ port: false, microservices: false });
  });

  it("ASP.NET Core re-asks its own questions, so it asks nothing here", () => {
    expect(capabilitiesOf(aspnetcoreAdapter)).toEqual({ port: false, microservices: false, tests: false, jwt: false, layers: false });
  });

  it("--jwt and the layer flags are accepted by Spring Boot and refused elsewhere", () => {
    const all = [springbootAdapter, fastapiAdapter, expressAdapter];
    expect(() => resolveNonInteractive(all, { stack: "springboot", jwt: true, fourLayer: true }, "App")).not.toThrow();
    for (const stack of ["fastapi", "express"]) {
      expect(() => resolveNonInteractive(all, { stack, jwt: true }, "App")).toThrow(/--jwt has no effect/);
      expect(() => resolveNonInteractive(all, { stack, threeLayer: true }, "App")).toThrow(/--three-layer has no effect/);
    }
  });
});
