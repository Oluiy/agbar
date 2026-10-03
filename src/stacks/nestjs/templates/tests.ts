import type { NestOrm } from "../types.js";

/**
 * The generated tests. `npm test` must pass on a fresh clone with no database
 * running, or "a working project" is a claim rather than a fact - so the unit tests
 * use a fake repository and the health test boots the app without touching storage.
 * The full HTTP suite lives in test:e2e, which resets a throwaway database first.
 */

export function serviceSpecTs(isClean: boolean): string {
  const servicePath = isClean ? "./items.service" : "./items.service";
  const itemType = isClean ? `import type { Item, NewItem } from "../domain/item.entity";` : `import type { ItemRecord } from "./items.repository";`;
  const recordType = isClean ? "Item" : "ItemRecord";
  const addSignature = isClean ? `async add(item: NewItem): Promise<Item> {` : `async add(name: string, description: string | null): Promise<ItemRecord> {`;
  const addBody = isClean
    ? `    const stored: Item = { id: this.rows.length + 1, name: item.name, description: item.description, createdAt: new Date() };`
    : `    const stored: ItemRecord = { id: this.rows.length + 1, name, description, createdAt: new Date() };`;
  const construct = isClean
    ? `  const service = new ItemsService(repository);`
    : `  const service = new ItemsService(repository as unknown as ItemsRepository);`;
  const extraImport = isClean ? "" : `import { ItemsRepository } from "./items.repository";\n`;

  return `${itemType}
${extraImport}import { ItemNotFoundError, ItemsService } from "${servicePath}";

/**
 * No database and no HTTP: the service depends on a repository, so an array is a
 * valid one. This is the payoff of the service not knowing about Prisma.
 */
class FakeItemsRepository {
  private rows: ${recordType}[] = [];

  ${addSignature}
${addBody}
    this.rows.push(stored);
    return stored;
  }

  async findById(id: number): Promise<${recordType} | null> {
    return this.rows.find((row) => row.id === id) ?? null;
  }

  async findPage(limit: number, offset: number): Promise<{ items: ${recordType}[]; total: number }> {
    return { items: this.rows.slice(offset, offset + limit), total: this.rows.length };
  }
}

function buildService(): ItemsService {
  const repository = new FakeItemsRepository();
${construct}
  return service;
}

describe("ItemsService", () => {
  it("creates an item and reads it back", async () => {
    const service = buildService();

    const created = await service.create("first", "hello");
    const found = await service.getById(created.id);

    expect(found.name).toBe("first");
  });

  it("throws a domain error, not an HTTP error, when the item is missing", async () => {
    const service = buildService();

    await expect(service.getById(999)).rejects.toThrow(ItemNotFoundError);
  });

  it("returns a bounded page and the full total", async () => {
    const service = buildService();
    for (const name of ["a", "b", "c"]) {
      await service.create(name, null);
    }

    const page = await service.list(2, 0);

    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(3);
  });
});
`;
}

export function healthSpecTs(orm: NestOrm): string {
  // With a database, readiness needs a live connection, so the unit-level test
  // covers liveness only - the real readiness check is exercised in the e2e suite.
  const providers =
    orm === "prisma"
      ? `      providers: [{ provide: PrismaService, useValue: { $queryRaw: jest.fn() } }],`
      : orm === "typeorm"
        ? `      providers: [{ provide: getDataSourceToken(), useValue: { query: jest.fn() } }],`
        : "";
  const imports =
    orm === "prisma"
      ? `import { PrismaService } from "../prisma/prisma.service";\n`
      : orm === "typeorm"
        ? `import { getDataSourceToken } from "@nestjs/typeorm";\n`
        : "";

  return `import { Test } from "@nestjs/testing";
${imports}import { HealthController } from "./health.controller";

describe("HealthController", () => {
  let controller: HealthController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
${providers}
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it("reports liveness without touching any dependency", () => {
    // Liveness must stay cheap: if it queried the database, a slow database would
    // make the orchestrator restart a perfectly healthy process.
    expect(controller.liveness()).toEqual({ status: "ok" });
  });
});
`;
}

export function appE2eSpecTs(orm: NestOrm): string {
  const itemsBlock =
    orm === "none"
      ? ""
      : `
  describe("/api/v1/items", () => {
    it("creates, then reads back", async () => {
      const created = await request(app.getHttpServer()).post("/api/v1/items").send({ name: "first", description: "hello" }).expect(201);

      await request(app.getHttpServer()).get(\`/api/v1/items/\${created.body.id}\`).expect(200).expect(({ body }) => {
        expect(body.name).toBe("first");
      });
    });

    it("rejects an unknown field rather than ignoring it", async () => {
      // forbidNonWhitelisted: a typo'd field is a 400, not a silently dropped value.
      await request(app.getHttpServer()).post("/api/v1/items").send({ name: "x", nmae: "typo" }).expect(400);
    });

    it("rejects a blank name", async () => {
      await request(app.getHttpServer()).post("/api/v1/items").send({ name: "" }).expect(400);
    });

    it("caps the page size", async () => {
      await request(app.getHttpServer()).get("/api/v1/items?limit=10000").expect(400);
    });

    it("paginates", async () => {
      for (const name of ["a", "b", "c"]) {
        await request(app.getHttpServer()).post("/api/v1/items").send({ name }).expect(201);
      }

      const { body } = await request(app.getHttpServer()).get("/api/v1/items?limit=2&offset=0").expect(200);

      expect(body.items).toHaveLength(2);
      expect(body.total).toBeGreaterThanOrEqual(3);
    });

    it("404s for a missing item", async () => {
      await request(app.getHttpServer()).get("/api/v1/items/999999").expect(404);
    });
  });
`;

  const readiness =
    orm === "none"
      ? `  it("reports readiness", async () => {
    await request(app.getHttpServer()).get("/api/v1/health/ready").expect(200);
  });`
      : `  it("reports readiness after actually querying the database", async () => {
    await request(app.getHttpServer()).get("/api/v1/health/ready").expect(200).expect(({ body }) => {
      expect(body.database).toBe("ok");
    });
  });`;

  return `import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * Full HTTP tests against a real application and a real database.
 *
 * The app is built the same way main.ts builds it - same prefix, same validation
 * pipe - because a test that configures the app differently is testing something
 * nobody deploys.
 */
describe("API (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1", { exclude: ["health"] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves liveness outside the version prefix", async () => {
    await request(app.getHttpServer()).get("/health").expect(200).expect({ status: "ok" });
  });

${readiness}
${itemsBlock}});
`;
}
