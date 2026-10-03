import { rel, toPackageName, type NodePaths } from "../layout.js";
import type { OrmContext, OrmPlugin } from "../orms/types.js";
import type { NodeDb, NodeFramework, NodeOrm } from "../types.js";

/**
 * The generated tests. They have to pass on a fresh clone with no database server
 * running, or "a working project" is a claim rather than a fact - so the HTTP tests use
 * an in-memory repository (no database at all), and only repository.test.ts needs a real
 * one: a temporary SQLite file, or TEST_DATABASE_URL for PostgreSQL.
 */

export function fakesTs(paths: NodePaths): string {
  return `import type { Item, NewItem } from "${rel("test/fakes.ts", paths.entity)}";
import type { ItemsRepository, Page } from "${rel("test/fakes.ts", paths.repository)}";

/** An array behind the repository interface: no database, no network, no setup. */
export class InMemoryItemsRepository implements ItemsRepository {
  private readonly rows: Item[] = [];

  async add(item: NewItem): Promise<Item> {
    const stored: Item = { id: this.rows.length + 1, name: item.name, description: item.description };
    this.rows.push(stored);
    return stored;
  }

  async find(id: number): Promise<Item | null> {
    return this.rows.find((row) => row.id === id) ?? null;
  }

  async page(limit: number, offset: number): Promise<Page> {
    return { items: this.rows.slice(offset, offset + limit), total: this.rows.length };
  }
}
`;
}

export function serviceTestTs(paths: NodePaths): string {
  return `import { describe, expect, it } from "vitest";
import { InvalidInputError, NotFoundError } from "../src/errors.js";
import { ItemsService } from "${rel("test/service.test.ts", paths.service)}";
import { InMemoryItemsRepository } from "./fakes.js";

function service(): ItemsService {
  return new ItemsService(new InMemoryItemsRepository());
}

describe("ItemsService", () => {
  it("creates an item and reads it back", async () => {
    const items = service();

    const created = await items.create({ name: "first" });

    expect((await items.get(created.id)).name).toBe("first");
  });

  it("trims the name", async () => {
    expect((await service().create({ name: "  padded  " })).name).toBe("padded");
  });

  it("rejects a blank or oversized name", async () => {
    await expect(service().create({ name: "   " })).rejects.toBeInstanceOf(InvalidInputError);
    await expect(service().create({ name: "x".repeat(201) })).rejects.toBeInstanceOf(InvalidInputError);
  });

  it("throws a domain error, not an HTTP one, when the item is missing", async () => {
    await expect(service().get(999)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lists a bounded page and the full total", async () => {
    const items = service();
    for (const name of ["a", "b", "c"]) await items.create({ name });

    const page = await items.list(2, 0);

    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(3);
  });
});
`;
}

/** The per-framework piece: how a test sends a request and what a created app looks like. */
function harness(framework: NodeFramework, paths: NodePaths): string {
  const service = rel("test/http.test.ts", paths.service);
  if (framework === "express") {
    return `import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { ItemsService } from "${service}";
import { InMemoryItemsRepository } from "./fakes.js";

interface Options {
  rateLimitMax?: number;
  ping?: () => Promise<void>;
}

function makeApp({ rateLimitMax = 1000, ping = async () => {} }: Options = {}) {
  return buildApp({
    items: new ItemsService(new InMemoryItemsRepository()),
    ping,
    config: { maxBodyBytes: 1_048_576, rateLimitMax, rateLimitWindowMs: 60_000 },
  });
}

type App = ReturnType<typeof makeApp>;

async function send(app: App, method: "get" | "post", url: string, body?: unknown) {
  const response = await request(app)[method](url).send(body as object | undefined);
  return { status: response.status, body: response.body as Record<string, unknown> };
}

async function sendRaw(app: App, url: string, raw: string) {
  const response = await request(app).post(url).set("content-type", "application/json").send(raw);
  return { status: response.status, body: response.body as Record<string, unknown> };
}
`;
  }
  return `import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { ItemsService } from "${service}";
import { InMemoryItemsRepository } from "./fakes.js";

interface Options {
  rateLimitMax?: number;
  ping?: () => Promise<void>;
}

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function makeApp({ rateLimitMax = 1000, ping = async () => {} }: Options = {}): Promise<FastifyInstance> {
  const app = await buildApp({
    items: new ItemsService(new InMemoryItemsRepository()),
    ping,
    config: { maxBodyBytes: 1_048_576, requestTimeoutMs: 10_000, rateLimitMax, rateLimitWindowMs: 60_000 },
  });
  apps.push(app);
  return app;
}

type App = FastifyInstance;

async function send(app: App, method: "get" | "post", url: string, body?: unknown) {
  const response = await app.inject({ method: method === "get" ? "GET" : "POST", url, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: response.statusCode, body: response.json() as Record<string, unknown> };
}

async function sendRaw(app: App, url: string, raw: string) {
  const response = await app.inject({ method: "POST", url, headers: { "content-type": "application/json" }, payload: raw });
  return { status: response.statusCode, body: response.json() as Record<string, unknown> };
}
`;
}

export function httpTestTs(framework: NodeFramework, orm: NodeOrm, paths: NodePaths): string {
  const await_ = framework === "express" ? "" : "await ";
  const header = harness(framework, paths);

  if (orm === "none") {
    // No feature and no database: only the shell exists, so that is all there is to test.
    const config =
      framework === "express"
        ? "{ maxBodyBytes: 1_048_576, rateLimitMax: 100, rateLimitWindowMs: 60_000 }"
        : "{ maxBodyBytes: 1_048_576, requestTimeoutMs: 10_000, rateLimitMax: 100, rateLimitWindowMs: 60_000 }";
    const send =
      framework === "express"
        ? `const response = await request(buildApp({ config: ${config} })).get(url);
  return { status: response.status, body: response.body as Record<string, unknown> };`
        : `const app = await buildApp({ config: ${config} });
  const response = await app.inject({ method: "GET", url });
  await app.close();
  return { status: response.statusCode, body: response.json() as Record<string, unknown> };`;
    const imports = framework === "express" ? `import request from "supertest";\n` : "";
    return `${imports}import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

async function get(url: string) {
  ${send}
}

describe("HTTP", () => {
  it("liveness is unversioned, because probes point at a fixed path", async () => {
    const { status, body } = await get("/health");

    expect(status).toBe(200);
    expect(body.status).toBe("ok");
  });

  it("readiness reports ready - add a check here for each dependency you cannot serve without", async () => {
    expect((await get("/api/v1/health/ready")).status).toBe(200);
  });

  it("an unknown route is a 404", async () => {
    expect((await get("/nope")).status).toBe(404);
  });
});
`;
  }

  return `${header}
describe("health", () => {
  it("liveness is unversioned, because probes point at a fixed path", async () => {
    const { status, body } = await send(${await_}makeApp(), "get", "/health");

    expect(status).toBe(200);
    expect(body.status).toBe("ok");
  });

  it("readiness checks the database and says so", async () => {
    const { status, body } = await send(${await_}makeApp(), "get", "/api/v1/health/ready");

    expect(status).toBe(200);
    expect(body).toEqual({ status: "ready", database: "ok" });
  });

  it("readiness is a 503 when the database is unreachable, so the load balancer pulls the instance", async () => {
    const down = ${await_}makeApp({ ping: async () => Promise.reject(new Error("connection refused")) });

    const { status, body } = await send(down, "get", "/api/v1/health/ready");

    expect(status).toBe(503);
    expect(body.database).toBe("unreachable");
  });
});

describe("items", () => {
  it("creates an item, then reads it back", async () => {
    const app = ${await_}makeApp();

    const created = await send(app, "post", "/api/v1/items", { name: "first", description: "hello" });
    expect(created.status).toBe(201);

    const fetched = await send(app, "get", \`/api/v1/items/\${created.body.id}\`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.name).toBe("first");
  });

  it("a missing item is a 404, not a 500", async () => {
    expect((await send(${await_}makeApp(), "get", "/api/v1/items/999999")).status).toBe(404);
  });

  it("a blank name is rejected as invalid input", async () => {
    expect((await send(${await_}makeApp(), "post", "/api/v1/items", { name: "   " })).status).toBe(422);
  });

  it("rejects an unknown field instead of ignoring it - a typo is a 400", async () => {
    expect((await send(${await_}makeApp(), "post", "/api/v1/items", { name: "x", nmae: "typo" })).status).toBe(400);
  });

  it("rejects malformed JSON as a 400, not a 500", async () => {
    expect((await sendRaw(${await_}makeApp(), "/api/v1/items", "{not json")).status).toBe(400);
  });

  it("rejects a non-numeric id as a 400", async () => {
    expect((await send(${await_}makeApp(), "get", "/api/v1/items/abc")).status).toBe(400);
  });

  it("paginates, and refuses a limit above the ceiling", async () => {
    const app = ${await_}makeApp();
    for (const name of ["a", "b", "c"]) await send(app, "post", "/api/v1/items", { name });

    const page = await send(app, "get", "/api/v1/items?limit=2&offset=0");
    expect(page.status).toBe(200);
    expect(page.body.items).toHaveLength(2);
    expect(page.body.total).toBe(3);

    expect((await send(app, "get", "/api/v1/items?limit=10000")).status).toBe(400);
  });
});

describe("rate limiting", () => {
  it("throttles a client that exceeds the limit, but never the health probes", async () => {
    const app = ${await_}makeApp({ rateLimitMax: 3 });

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await send(app, "get", "/api/v1/items")).status);

    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses.slice(3)).toEqual([429, 429, 429]);
    expect((await send(app, "get", "/health")).status).toBe(200);
    expect((await send(app, "get", "/api/v1/health/ready")).status).toBe(200);
  });
});
`;
}

export function repositoryTestTs(label: string): string {
  return `import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect } from "../src/db.js";
import type { Database } from "../src/database.js";

// global-setup.ts points this at a temporary SQLite file (or reads TEST_DATABASE_URL for
// PostgreSQL). Never DATABASE_URL: a test run must not touch real data.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("${label} repository against a real database", () => {
  let database: Database;

  beforeAll(async () => {
    database = await connect(url ?? "");
  });

  afterAll(async () => {
    await database.close();
  });

  it("answers the readiness ping", async () => {
    await expect(database.ping()).resolves.toBeUndefined();
  });

  it("stores an item and finds it by id", async () => {
    const stored = await database.repository.add({ name: "persisted", description: "kept" });

    expect(await database.repository.find(stored.id)).toEqual({ id: stored.id, name: "persisted", description: "kept" });
  });

  it("returns null for an id that does not exist", async () => {
    expect(await database.repository.find(987654321)).toBeNull();
  });

  it("returns a bounded page and the full total, in id order", async () => {
    for (const name of ["p1", "p2", "p3"]) await database.repository.add({ name, description: null });

    const page = await database.repository.page(2, 0);

    expect(page.items).toHaveLength(2);
    expect(page.total).toBeGreaterThanOrEqual(3);
    expect(page.items[0]!.id).toBeLessThan(page.items[1]!.id);
  });
});
`;
}

export function globalSetupTs(projectName: string, db: NodeDb, plugin: OrmPlugin, ctx: OrmContext): string {
  const sqlite = db === "sqlite";
  return `${plugin.createSchemaImports}
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Creates the schema in a DEDICATED test database before the suite runs.
 *
 * Never uses DATABASE_URL and never passes --force-reset: pointing a reset at whatever
 * .env contains would wipe a real development database.
 */
export default async function setup(): Promise<(() => void) | undefined> {
  let url = process.env.TEST_DATABASE_URL;
  let scratch: string | undefined;

  if (!url) {
${
  sqlite
    ? `    // No server needed: a temporary SQLite file, removed afterwards.
    scratch = mkdtempSync(path.join(tmpdir(), "${toPackageName(projectName)}-test-"));
    url = \`file:\${path.join(scratch, "test.db")}\`;
    process.env.TEST_DATABASE_URL = url;`
    : `    // PostgreSQL needs a real server, so the repository tests are skipped until
    // TEST_DATABASE_URL points at a throwaway database.
    return undefined;`
}
  }

  ${plugin.createSchemaSnippet(ctx)}

  return () => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  };
}
`;
}
