import type { FastApiDb } from "../types.js";

/** Container setup: a non-root image, and compose for the database when there is one. */

export function dockerfile(db: FastApiDb): string {
  const deps = db === "postgres" ? "requirements.txt" : "requirements.txt";
  return `# Pinned to a minor version: "python:3-slim" would silently change Python under you.
FROM python:3.12-slim AS base

# Fail fast and log immediately - unbuffered output is what makes container logs useful.
ENV PYTHONUNBUFFERED=1 \\
    PYTHONDONTWRITEBYTECODE=1 \\
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencies are copied and installed before the source, so editing a .py file
# does not invalidate the dependency layer on every rebuild.
COPY ${deps} ./
RUN pip install --no-cache-dir -r ${deps}

COPY . .

# Never root: a container that is compromised should not also be privileged.
RUN useradd --create-home --uid 10001 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

# The liveness endpoint doubles as the container health check.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \\
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2).status == 200 else 1)"

# "fastapi run", not "fastapi dev": the dev command enables reload, which watches the
# filesystem and runs a single worker - wrong for an image.
CMD ["fastapi", "run", "app/main.py", "--host", "0.0.0.0", "--port", "8000"]
`;
}

export function dockerCompose(projectName: string, db: FastApiDb): string {
  const name = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  if (db !== "postgres") {
    return `services:
  api:
    build: .
    ports:
      - "8000:8000"
    env_file:
      - .env
    restart: unless-stopped
`;
  }

  return `services:
  api:
    build: .
    ports:
      - "8000:8000"
    env_file:
      - .env
    environment:
      # Overrides the .env default: inside the compose network the host is the
      # service name, not localhost.
      DATABASE_URL: postgresql+psycopg://postgres:\${POSTGRES_PASSWORD:-postgres}@db:5432/${name}
    depends_on:
      db:
        # Not just "started": the API would otherwise race the database and crash
        # on its first connection.
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: postgres
      # Set POSTGRES_PASSWORD in your shell or .env; this default is for local only.
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
