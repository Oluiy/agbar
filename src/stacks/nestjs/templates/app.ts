import type { NestDb, NestOrm } from "../types.js";

/** The application shell: entrypoint, root module, typed configuration, health. */

export function mainTs(): string {
  return `import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // /health stays outside the prefix: probes point at a fixed path, and moving it
  // when the API version changes is how a deploy starts failing its own checks.
  app.setGlobalPrefix("api/v1", { exclude: ["health"] });

  app.useGlobalPipes(
    new ValidationPipe({
      // Strips properties with no decorator, then rejects the request if any were
      // sent: a typo'd field becomes a 400, not a silently ignored value.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // SIGTERM during a deploy drains in-flight requests and closes the database pool
  // instead of cutting connections mid-response.
  app.enableShutdownHooks();

  const port = app.get(ConfigService).get<number>("port", 3000);
  await app.listen(port);
}

void bootstrap();
`;
}

export function appModuleTs(orm: NestOrm): string {
  const ormImport =
    orm === "prisma"
      ? `import { PrismaModule } from "./prisma/prisma.module";\n`
      : orm === "typeorm"
        ? `import { DatabaseModule } from "./database/database.module";\n`
        : "";
  const ormModule = orm === "prisma" ? "    PrismaModule,\n" : orm === "typeorm" ? "    DatabaseModule,\n" : "";
  const itemsImport = orm === "none" ? "" : `import { ItemsModule } from "./modules/items/items.module";\n`;
  const itemsModule = orm === "none" ? "" : "    ItemsModule,\n";

  return `import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { configuration, validateEnv } from "./config/configuration";
import { HealthModule } from "./health/health.module";
${itemsImport}${ormImport}
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      // Fails at startup on a missing or malformed variable, with the variable
      // named - rather than surfacing as a confusing error on the first request.
      validate: validateEnv,
      cache: true,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.get<number>("throttle.ttl", 60_000),
            limit: config.get<number>("throttle.limit", 100),
          },
        ],
      }),
    }),
${ormModule}${itemsModule}    HealthModule,
  ],
  providers: [
    // Applied globally rather than per-controller, so a route added next month is
    // covered without anyone remembering to decorate it.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
`;
}

export function configurationTs(orm: NestOrm): string {
  const dbField = orm === "none" ? "" : `  databaseUrl: process.env.DATABASE_URL ?? "",\n`;
  const dbCheck =
    orm === "none"
      ? ""
      : `
  if (!process.env.DATABASE_URL) {
    missing.push("DATABASE_URL");
  }
`;

  return `/**
 * Configuration is read once, typed, and validated at startup.
 *
 * Reading process.env directly from a service is what makes a missing variable
 * surface as a confusing runtime error much later; this turns it into a startup
 * failure that names the variable.
 */
export const configuration = () => ({
  env: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
${dbField}  // Most HTTP clients have no timeout unless you set one, which lets a single slow
  // dependency hold a worker open indefinitely. Pass this to every client you build.
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 10_000),
  throttle: {
    ttl: Number(process.env.THROTTLE_TTL_MS ?? 60_000),
    limit: Number(process.env.THROTTLE_LIMIT ?? 100),
  },
});

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const missing: string[] = [];
  const invalid: string[] = [];
${dbCheck}
  const port = Number(config.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0) {
    invalid.push(\`PORT must be a positive integer (got "\${String(config.PORT)}")\`);
  }

  if (missing.length > 0) {
    invalid.push(\`missing required variable(s): \${missing.join(", ")}\`);
  }
  if (invalid.length > 0) {
    throw new Error(\`Invalid configuration - \${invalid.join("; ")}. See .env.example.\`);
  }
  return config;
}
`;
}

export function healthControllerTs(orm: NestOrm): string {
  if (orm === "none") {
    return `import { Controller, Get } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";

@Controller()
@SkipThrottle() // A probe that gets rate-limited reports a false outage.
export class HealthController {
  /** Liveness: "am I running?" Mounted at /health, outside the version prefix. */
  @Get("health")
  liveness(): { status: string } {
    return { status: "ok" };
  }

  /**
   * Readiness: "can I serve traffic?" Nothing to check yet - add each dependency
   * you cannot serve without, and return 503 when one is unreachable.
   */
  @Get("health/ready")
  readiness(): { status: string } {
    return { status: "ready" };
  }
}
`;
  }

  const probe =
    orm === "prisma"
      ? `    try {
      await this.prisma.$queryRaw\`SELECT 1\`;
    } catch {`
      : `    try {
      await this.dataSource.query("SELECT 1");
    } catch {`;
  const inject =
    orm === "prisma"
      ? `  constructor(private readonly prisma: PrismaService) {}`
      : `  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}`;
  const imports =
    orm === "prisma"
      ? `import { PrismaService } from "../prisma/prisma.service";`
      : `import { InjectDataSource } from "@nestjs/typeorm";\nimport { DataSource } from "typeorm";`;

  return `import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Response } from "express";
${imports}

@Controller()
@SkipThrottle() // A probe that gets rate-limited reports a false outage.
export class HealthController {
${inject}

  /** Liveness: "am I running?" Mounted at /health, outside the version prefix. */
  @Get("health")
  liveness(): { status: string } {
    return { status: "ok" };
  }

  /**
   * Readiness: "can I serve traffic?" - so it actually touches the database. A
   * process that is up but cannot reach its database should be pulled out of the
   * load balancer, not sent requests, which is why this returns 503.
   */
  @Get("health/ready")
  async readiness(@Res() response: Response): Promise<void> {
${probe}
      response.status(HttpStatus.SERVICE_UNAVAILABLE).json({ status: "not ready", database: "unreachable" });
      return;
    }
    response.status(HttpStatus.OK).json({ status: "ready", database: "ok" });
  }
}
`;
}

export function healthModuleTs(orm: NestOrm): string {
  const extra = orm === "prisma" ? `import { PrismaModule } from "../prisma/prisma.module";\n` : "";
  const imports = orm === "prisma" ? `\n  imports: [PrismaModule],` : "";
  return `import { Module } from "@nestjs/common";
${extra}import { HealthController } from "./health.controller";

@Module({${imports}
  controllers: [HealthController],
})
export class HealthModule {}
`;
}

export function prismaServiceTs(db: NestDb): string {
  const adapterImport =
    db === "postgres" ? `import { PrismaPg } from "@prisma/adapter-pg";` : `import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";`;
  const adapter =
    db === "postgres"
      ? `new PrismaPg({ connectionString: config.getOrThrow<string>("databaseUrl") })`
      : `new PrismaBetterSqlite3({ url: config.getOrThrow<string>("databaseUrl") })`;

  return `import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
${adapterImport}
import { PrismaClient } from "../generated/client";

/**
 * The Prisma client as an injectable singleton, with its connection tied to the
 * module lifecycle: one pool for the process, closed on shutdown. Letting each
 * service construct its own PrismaClient is how a service ends up with dozens of
 * connection pools and exhausts the database's connection limit.
 *
 * Prisma 7 no longer reads the connection URL from schema.prisma: the client is given
 * a driver adapter instead, built here from the validated configuration.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    super({ adapter: ${adapter} });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log("Database connected");
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
`;
}

export function prismaModuleTs(): string {
  return `import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

// Global so every feature module can inject PrismaService without re-importing
// this module - the one case where @Global is clearer than repetition.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
`;
}

/** The Prisma CLI's configuration (Prisma 7 moved the datasource URL out of the schema). */
export function prismaConfigTs(): string {
  return `// Read by the Prisma CLI (generate, db push, migrate). The running app does not use this
// file: it connects through the driver adapter in src/prisma/prisma.service.ts.
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Fails with the variable named when it is missing, rather than with an opaque
    // connection error later.
    url: env("DATABASE_URL"),
  },
});
`;
}

export function prismaSchema(db: NestDb): string {
  return `// Prisma schema. Change this file, then run:
//   npm run db:migrate -- --name what_changed
// Read the generated SQL before applying it: autogenerate is a draft, not an authority.

// Prisma 7: the "prisma-client" generator writes the client into your source tree (so tsc
// and Jest compile it like any other file) instead of into node_modules. moduleFormat is
// "cjs" because this NestJS project compiles to CommonJS. The directory is gitignored
// and rebuilt by "npm install" (postinstall).
generator client {
  provider     = "prisma-client"
  output       = "../src/generated"
  moduleFormat = "cjs"
}

// No "url" here: Prisma 7 rejects it. The connection URL for the CLI lives in
// prisma.config.ts, and the running app passes a driver adapter to PrismaClient.
datasource db {
  provider = "${db === "postgres" ? "postgresql" : "sqlite"}"
}

model Item {
  id          Int      @id @default(autoincrement())
  name        String
  description String?
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  // Listing sorts and filters on name, and an unindexed column is the first thing
  // to hurt once the table grows.
  @@index([name])
  @@map("items")
}
`;
}
