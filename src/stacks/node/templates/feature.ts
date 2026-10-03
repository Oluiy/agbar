import { rel, type NodePaths } from "../layout.js";
import type { NodeFramework, NodeStructure } from "../types.js";

/**
 * The example feature: one Item, modelled end to end, so the generated project is a
 * working reference to copy rather than an empty folder tree. Every relative import is
 * computed from the importing file, because ESM TypeScript needs correct ".js" paths.
 */

export function errorsTs(): string {
  return `/**
 * What the business rules can fail with. Plain classes with no HTTP in them, so the same
 * service can back a CLI or a queue consumer; the HTTP layer turns them into status codes.
 */
export class NotFoundError extends Error {
  constructor(
    readonly resource: string,
    readonly id: number | string,
  ) {
    super(\`\${resource} \${id} does not exist\`);
    this.name = "NotFoundError";
  }
}

export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidInputError";
  }
}
`;
}

export function entityTs(structure: NodeStructure): string {
  const intro =
    structure === "clean"
      ? `/**
 * The domain's own Item: plain types with no Prisma, no zod and no web framework.
 *
 * Nothing in domain/ imports outward. That is what lets the rules be tested without a
 * database and keeps a schema or JSON change from rippling into them.
 */`
      : `/** The item as the rest of the feature sees it - not the database row, so a column added later is not exposed by accident. */`;
  return `${intro}
export interface Item {
  readonly id: number;
  readonly name: string;
  readonly description: string | null;
}

/** An item before storage has assigned it an id. */
export interface NewItem {
  readonly name: string;
  readonly description: string | null;
}
`;
}

export function repositoryTs(paths: NodePaths): string {
  return `import type { Item, NewItem } from "${rel(paths.repository, paths.entity)}";

export interface Page {
  items: Item[];
  total: number;
}

/**
 * What the service needs from storage, declared here rather than by the database. An
 * implementation can be Prisma, or an array in a test: TypeScript checks the shape, so
 * no base class or decorator is needed.
 */
export interface ItemsRepository {
  add(item: NewItem): Promise<Item>;
  find(id: number): Promise<Item | null>;
  /** One bounded page and the total - never the whole table. */
  page(limit: number, offset: number): Promise<Page>;
}
`;
}

export function serviceTs(paths: NodePaths): string {
  return `import { InvalidInputError, NotFoundError } from "${rel(paths.service, "src/errors.ts")}";
import type { Item } from "${rel(paths.service, paths.entity)}";
import type { ItemsRepository, Page } from "${rel(paths.service, paths.repository)}";

const MAX_NAME_CHARS = 200;

export interface CreateItemInput {
  name: string;
  description?: string | null | undefined;
}

/**
 * The business rules. Takes a repository, not a Prisma client, so it is tested with an
 * array and never sees a database. Throws plain errors, not HTTP ones.
 */
export class ItemsService {
  constructor(private readonly repository: ItemsRepository) {}

  async create(input: CreateItemInput): Promise<Item> {
    const name = input.name.trim();
    if (name.length === 0) {
      throw new InvalidInputError("name must not be blank");
    }
    if ([...name].length > MAX_NAME_CHARS) {
      throw new InvalidInputError(\`name must be at most \${MAX_NAME_CHARS} characters\`);
    }
    return this.repository.add({ name, description: input.description ?? null });
  }

  async get(id: number): Promise<Item> {
    const item = await this.repository.find(id);
    if (item === null) {
      throw new NotFoundError("item", id);
    }
    return item;
  }

  list(limit: number, offset: number): Promise<Page> {
    return this.repository.page(limit, offset);
  }
}
`;
}

export function schemasTs(): string {
  return `import { z } from "zod";

/** Hard ceiling on a page. Validation rejects anything above it before any code runs. */
export const MAX_LIMIT = 200;

/**
 * strictObject rejects unknown keys: a typo'd field becomes a 400 instead of being
 * silently ignored.
 */
export const createItemSchema = z.strictObject({
  name: z.string(),
  description: z.string().nullish(),
});

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const idSchema = z.coerce.number().int().positive();
`;
}

export function httpTs(paths: NodePaths, framework: NodeFramework): string {
  const schemas = rel(paths.http, paths.schemas);
  const service = rel(paths.http, paths.service);

  if (framework === "express") {
    return `import { Router } from "express";
import type { ItemsService } from "${service}";
import { createItemSchema, idSchema, listQuerySchema } from "${schemas}";

/**
 * HTTP only: parse, call the service, shape the response. Express 5 forwards a rejected
 * async handler to the error middleware, so there is no try/catch and no wrapper here.
 */
export function itemsRouter(items: ItemsService): Router {
  const router = Router();

  router.post("/items", async (req, res) => {
    const item = await items.create(createItemSchema.parse(req.body));
    res.status(201).json(item);
  });

  router.get("/items", async (req, res) => {
    // Parsed into a new object: Express 5's req.query is a read-only getter.
    const { limit, offset } = listQuerySchema.parse(req.query);
    const page = await items.list(limit, offset);
    res.json({ items: page.items, total: page.total, limit, offset });
  });

  router.get("/items/:id", async (req, res) => {
    res.json(await items.get(idSchema.parse(req.params.id)));
  });

  return router;
}
`;
  }

  return `import type { FastifyInstance } from "fastify";
import type { ItemsService } from "${service}";
import { createItemSchema, idSchema, listQuerySchema } from "${schemas}";

export interface ItemsRoutesOptions {
  items: ItemsService;
}

/**
 * HTTP only: parse, call the service, shape the response. A Fastify plugin, registered
 * under the version prefix in app.ts; a handler that throws reaches the app's error
 * handler, so there is no try/catch here.
 */
export async function itemsRoutes(app: FastifyInstance, { items }: ItemsRoutesOptions): Promise<void> {
  app.post("/items", async (request, reply) => {
    const item = await items.create(createItemSchema.parse(request.body));
    return reply.code(201).send(item);
  });

  app.get("/items", async (request) => {
    const { limit, offset } = listQuerySchema.parse(request.query);
    const page = await items.list(limit, offset);
    return { items: page.items, total: page.total, limit, offset };
  });

  app.get("/items/:id", async (request) => {
    const { id } = request.params as { id: string };
    return items.get(idSchema.parse(id));
  });
}
`;
}
