import { rel, toPackageName, type NodePaths } from "../layout.js";
import type { NodeDb, NodeFramework, NodeOrm } from "../types.js";

/** The application shell: config, database, the framework app, and the server entrypoint. */

export function configTs(projectName: string, orm: NodeOrm, db: NodeDb): string {
  const dbField =
    orm === "none"
      ? ""
      : db === "sqlite"
        ? `  // A file next to the project, so a fresh clone runs with no database server.
  DATABASE_URL: z.string().min(1).default("file:./${toPackageName(projectName)}.db"),\n`
        : `  // No default: a connection string carries a password, and a password in source is a
  // leaked password. Set it in the environment (.env locally, a secret in deployment).
  DATABASE_URL: z.string().min(1),\n`;
  const dbOut = orm === "none" ? "" : "    databaseUrl: env.DATABASE_URL,\n";

  return `import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
${dbField}  /** Most servers and clients have no timeout unless one is set, which lets one slow dependency hold a worker open indefinitely. */
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  MAX_BODY_BYTES: z.coerce.number().int().positive().default(1_048_576),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
});

export interface Config {
  port: number;
${orm === "none" ? "" : "  databaseUrl: string;\n"}  requestTimeoutMs: number;
  maxBodyBytes: number;
  rateLimitMax: number;
  rateLimitWindowMs: number;
}

/**
 * Reads and validates the environment once, at startup. A missing or malformed variable
 * stops the process here, naming the variable, instead of surfacing as a confusing error
 * on the first request.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => \`\${issue.path.join(".")}: \${issue.message}\`).join("; ");
    throw new Error(\`Invalid configuration - \${problems}. See .env.example.\`);
  }
  const env = parsed.data;
  return {
    port: env.PORT,
${dbOut}    requestTimeoutMs: env.REQUEST_TIMEOUT_MS,
    maxBodyBytes: env.MAX_BODY_BYTES,
    rateLimitMax: env.RATE_LIMIT_MAX,
    rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
  };
}
`;
}

/**
 * src/database.ts: the one interface the rest of the project knows the database by. Each
 * ORM's db.ts implements `connect()` returning this, so the server, the tests and the
 * routes never name an ORM - swapping one is a change inside db.ts and the repository.
 */
export function databaseTs(paths: NodePaths): string {
  return `import type { ItemsRepository } from "${rel("src/database.ts", paths.repository)}";

export interface Database {
  repository: ItemsRepository;
  /** Resolves when the database answers; rejects when it cannot. Backs the readiness probe. */
  ping(): Promise<void>;
  /** Releases the connection pool. Called on shutdown, so a deploy does not leak connections. */
  close(): Promise<void>;
}
`;
}

export interface AppImports {
  paths: NodePaths;
  orm: NodeOrm;
}

/** The imports and deps shared by both apps; `none` has no feature, so none of it. */
function featureImports(framework: NodeFramework, { paths, orm }: AppImports): string {
  if (orm === "none") return "";
  const from = "src/app.ts";
  const route = framework === "express" ? "itemsRouter" : "itemsRoutes";
  return `import { ${route} } from "${rel(from, paths.http)}";
import type { ItemsService } from "${rel(from, paths.service)}";
`;
}

const ERRORS_IMPORT = `import { InvalidInputError, NotFoundError } from "./errors.js";`;

export function expressAppTs(imports: AppImports): string {
  const hasDb = imports.orm !== "none";
  return `import express, { Router, type ErrorRequestHandler, type Express } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { ZodError } from "zod";
import type { Config } from "./config.js";
${ERRORS_IMPORT}
${featureImports("express", imports)}
export interface AppDeps {
${hasDb ? "  items: ItemsService;\n  /** Resolves when the database answers; rejects when it cannot. */\n  ping: () => Promise<void>;\n" : ""}  config: Pick<Config, "maxBodyBytes" | "rateLimitMax" | "rateLimitWindowMs">;
}

/** The one place a thrown error becomes an HTTP status. */
const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({ error: "invalid request", issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    return;
  }
  if (error instanceof InvalidInputError) {
    res.status(422).json({ error: error.message });
    return;
  }
  if (error instanceof NotFoundError) {
    res.status(404).json({ error: "not found" });
    return;
  }
  // body-parser marks its own failures (bad JSON, body too large) with a 4xx status.
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    res.status(status).json({ error: status === 413 ? "payload too large" : "bad request" });
    return;
  }
  // Logged, never returned: an error message can leak table names, SQL or paths.
  console.error(error);
  res.status(500).json({ error: "internal server error" });
};

/**
 * Builds the app from its dependencies and returns it without listening, so tests drive
 * it in-process and server.ts decides the port.
 */
export function buildApp(deps: AppDeps): Express {
  const app = express();

  app.use(helmet());
  app.use(express.json({ limit: deps.config.maxBodyBytes }));

  // Outside the version prefix: probes point at a fixed path, and moving it when the API
  // version changes is how a deploy starts failing its own checks.
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  const api = Router();

  // Registered before the limiter: a throttled probe reports a false outage.
  api.get("/health/ready", async (_req, res) => {
${
  hasDb
    ? `    try {
      await deps.ping();
      res.json({ status: "ready", database: "ok" });
    } catch {
      res.status(503).json({ status: "not ready", database: "unreachable" });
    }`
    : `    res.json({ status: "ready" });`
}
  });

  // Per-client rate limiting for everything below, set once so a route added later is
  // covered without anyone remembering to opt in.
  api.use(rateLimit({ windowMs: deps.config.rateLimitWindowMs, limit: deps.config.rateLimitMax, standardHeaders: "draft-8", legacyHeaders: false }));
${hasDb ? "  api.use(itemsRouter(deps.items));\n" : ""}
  app.use("/api/v1", api);
  app.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });
  app.use(errorHandler);

  return app;
}
`;
}

export function fastifyAppTs(imports: AppImports): string {
  const hasDb = imports.orm !== "none";
  return `import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { Config } from "./config.js";
${ERRORS_IMPORT}
${featureImports("fastify", imports)}
export interface AppDeps {
${hasDb ? "  items: ItemsService;\n  /** Resolves when the database answers; rejects when it cannot. */\n  ping: () => Promise<void>;\n" : ""}  config: Pick<Config, "maxBodyBytes" | "requestTimeoutMs" | "rateLimitMax" | "rateLimitWindowMs">;
  /** Request logging. Off in tests, on in server.ts. */
  logger?: boolean;
}

/**
 * Builds the app from its dependencies and returns it without listening, so tests use
 * app.inject() and server.ts decides the port.
 */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger ?? false,
    bodyLimit: deps.config.maxBodyBytes,
    // Bounds how long a request may take to arrive, so a stalled client cannot hold a
    // socket open indefinitely.
    requestTimeout: deps.config.requestTimeoutMs,
  });

  await app.register(helmet);
  // Per-client rate limiting for every route, set once so a route added later is covered.
  await app.register(rateLimit, { max: deps.config.rateLimitMax, timeWindow: deps.config.rateLimitWindowMs });

  /** The one place a thrown error becomes an HTTP status. */
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "invalid request", issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    }
    if (error instanceof InvalidInputError) {
      return reply.code(422).send({ error: error.message });
    }
    if (error instanceof NotFoundError) {
      return reply.code(404).send({ error: "not found" });
    }
    // Fastify's own 4xx (bad JSON, body too large) and the rate limiter's 429.
    const status = (error as { statusCode?: unknown }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply.code(status).send({ error: (error as Error).message });
    }
    // Logged, never returned: an error message can leak table names, SQL or paths.
    request.log.error(error);
    return reply.code(500).send({ error: "internal server error" });
  });

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: "not found" }));

  // Outside the version prefix, and exempt from the limiter: a throttled probe reports a
  // false outage, and probes point at a fixed path.
  app.get("/health", { config: { rateLimit: false } }, async () => ({ status: "ok" }));

  await app.register(
    async (api) => {
      api.get("/health/ready", { config: { rateLimit: false } }, async (_request, reply) => {
${
  hasDb
    ? `        try {
          await deps.ping();
          return { status: "ready", database: "ok" };
        } catch {
          return reply.code(503).send({ status: "not ready", database: "unreachable" });
        }`
    : `        void reply;
        return { status: "ready" };`
}
      });
${hasDb ? "      await api.register(itemsRoutes, { items: deps.items });\n" : ""}    },
    { prefix: "/api/v1" },
  );

  return app;
}
`;
}

export function serverTs(framework: NodeFramework, imports: AppImports): string {
  const { paths, orm } = imports;
  const hasDb = orm !== "none";
  const from = "src/server.ts";
  const db = hasDb
    ? `import { connect } from "./db.js";
import { ItemsService } from "${rel(from, paths.service)}";
`
    : "";
  const wiring = hasDb
    ? `const database = await connect(config.databaseUrl);
const items = new ItemsService(database.repository);
`
    : "";
  const deps = hasDb ? "{ items, ping: () => database.ping(), config" : "{ config";
  const disconnect = hasDb ? "  await database.close();\n" : "";

  if (framework === "express") {
    return `import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
${db}
const config = loadConfig();
${wiring}
const server = buildApp(${deps} }).listen(config.port, () => {
  console.log(\`listening on :\${config.port}\`);
});

// Node's defaults allow a request five minutes to arrive. headersTimeout may not exceed
// requestTimeout, so both are set to the configured value.
server.headersTimeout = config.requestTimeoutMs;
server.requestTimeout = config.requestTimeoutMs;

/** Finish in-flight requests on SIGTERM/SIGINT instead of cutting them off, so a deploy does not drop connections mid-response. */
function shutdown(signal: string): void {
  console.log(\`\${signal} received, shutting down\`);
  server.close(async () => {
${disconnect.replace(/^ {2}/, "    ")}    process.exit(0);
  });
  // Do not wait forever for a client that never hangs up.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
`;
  }

  return `import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
${db}
const config = loadConfig();
${wiring}
const app = await buildApp(${deps}, logger: true });

/** Finish in-flight requests on SIGTERM/SIGINT instead of cutting them off, so a deploy does not drop connections mid-response. */
async function shutdown(signal: string): Promise<void> {
  app.log.info(\`\${signal} received, shutting down\`);
  await app.close();
${disconnect}  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: config.port, host: "0.0.0.0" });
`;
}
