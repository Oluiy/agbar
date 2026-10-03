import type { NestDb, NestOrm } from "../types.js";

export function dockerfile(orm: NestOrm, db: NestDb): string {
  const generate = orm === "prisma" ? "\n# The Prisma client is generated code, so it has to exist before the build.\nRUN npx prisma generate\n" : "";
  // prisma.config.ts uses env("DATABASE_URL"), which throws when unset - and "npm ci" runs
  // prisma generate (postinstall) before anything could supply one. generate never
  // connects, so a placeholder satisfies it. Builder stage only: the runtime image does
  // not get it, so a real DATABASE_URL is still required there.
  const placeholder = db === "postgres" ? "postgresql://build:build@localhost:5432/build" : "file:./build-only.db";
  const buildEnv =
    orm === "prisma" ? `\n# Build-time only (this stage is discarded): lets "prisma generate" load its config.\nENV DATABASE_URL="${placeholder}"\n` : "";

  return `# NestJS 12 needs Node 22.22.3+ / 24.15+ (its own requirement), so this is pinned to 24 rather
# than a floating 22. Debian ("slim"), not Alpine: the SQLite driver ships glibc builds.
# Debian trixie (glibc 2.41), not the default bookworm (2.36): prebuilt native modules are
# built on newer systems and refuse to load on an older glibc ("GLIBC_2.38 not found").
FROM node:24-trixie-slim AS builder

WORKDIR /app
${buildEnv}
# Manifests first: editing a .ts file then does not invalidate the dependency layer.
# "npm ci" needs a package-lock.json - run "npm install" once and commit the lock file.
COPY package*.json ./
${orm === "prisma" ? "COPY prisma ./prisma\nCOPY prisma.config.ts ./\n" : ""}# A BuildKit cache mount: rebuilds reuse downloaded packages, and an interrupted build
# (a registry timeout) resumes instead of starting the download over.
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .
${generate}RUN npm run build \\
    # Drops dev dependencies but keeps native modules (the SQLite driver) already built.
    && npm prune --omit=dev

# A second stage so the image ships without dev dependencies or TypeScript sources.
FROM node:24-trixie-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
# node_modules comes from the builder, already pruned to production dependencies. Running
# "npm ci" here instead would re-run install scripts: the postinstall needs the prisma CLI
# (a dev dependency), and --ignore-scripts would skip the SQLite driver's native build.
COPY --from=builder /app/node_modules ./node_modules
# Prisma 7 generates its client into src/generated, which compiles into dist/ with the
# rest of the app - so there is no separate node_modules/.prisma to copy across.
COPY --from=builder /app/dist ./dist

# Never root: a compromised container should not also be privileged. The node image
# ships a "node" user for exactly this.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \\
    CMD node -e "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/main"]
`;
}

export function dockerCompose(projectName: string, orm: NestOrm, db: NestDb): string {
  const name = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  if (orm === "none" || db !== "postgres") {
    return `services:
  api:
    build: .
    ports:
      - "3000:3000"
    env_file:
      - .env
    restart: unless-stopped
`;
  }

  return `services:
  api:
    build: .
    ports:
      - "3000:3000"
    env_file:
      - .env
    environment:
      # Overrides the .env default: inside the compose network the host is the
      # service name, not localhost.
      DATABASE_URL: postgresql://postgres:\${POSTGRES_PASSWORD:-postgres}@db:5432/${name}?schema=public
    depends_on:
      db:
        # Not just "started": the API would otherwise race the database and crash
        # on its first query.
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: postgres
      # Set POSTGRES_PASSWORD in your shell or .env; this default is local-only.
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-postgres}
      POSTGRES_DB: ${name}
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d ${name}"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  pgdata:
`;
}
