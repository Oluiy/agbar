import type { DjangoDb, DjangoStructure } from "../types.js";

/**
 * Dependencies are lower bounds, never pins: the resolver picks current versions at
 * install time. "django>=5.2" is deliberate - 5.2 is the LTS and runs on Python 3.10+,
 * while Django 6.x needs 3.12+. Pip picks whichever the interpreter can run, so one
 * declaration works on both.
 */
export function requirementsTxt(db: DjangoDb, includeDocker: boolean): string {
  const lines = ["django>=5.2", "djangorestframework>=3.16"];
  if (db === "postgres") lines.push("psycopg[binary]>=3.2");
  if (includeDocker) lines.push("gunicorn>=23");
  return `${lines.join("\n")}\n`;
}

export function envExample(projectName: string, db: DjangoDb): string {
  const dbName = projectName.toLowerCase();
  const dbLines =
    db === "postgres"
      ? `POSTGRES_DB=${dbName}
POSTGRES_USER=postgres
# Replace before using this anywhere real.
POSTGRES_PASSWORD=CHANGE_ME
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
`
      : "";

  return `# Copy to .env and edit. .env is gitignored; this file documents the shape.
# Generate a key: python -c 'from django.core.management.utils import get_random_secret_key as g; print(g())'
DJANGO_SECRET_KEY=CHANGE_ME
DJANGO_DEBUG=false
DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1
${dbLines}THROTTLE_ANON=100/min
THROTTLE_USER=1000/min
REQUEST_TIMEOUT_SECONDS=10
`;
}

export function gitignore(projectName: string, db: DjangoDb): string {
  const dbFile = db === "sqlite" ? `\n# Local database\n${projectName.toLowerCase()}.sqlite3\n` : "";
  return `# Secrets - .env.example documents the shape instead.
.env
.env.*
!.env.example

# Python
__pycache__/
*.py[cod]
.venv/
venv/
*.egg-info/
staticfiles/
${dbFile}
# Editors / OS
.idea/
.vscode/
.DS_Store
`;
}

export function dockerfile(): string {
  return `# Pinned to a minor: "python:3" would silently change Python under you.
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \\
    PYTHONDONTWRITEBYTECODE=1 \\
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencies before source, so editing a .py file does not invalidate this layer.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Never root: a compromised container should not also be privileged.
RUN useradd --create-home --uid 10001 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \\
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2).status == 200 else 1)"

# gunicorn, not "manage.py runserver": runserver is a development server and is
# explicitly not for production. DJANGO_SECRET_KEY must be provided at run time.
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--timeout", "30"]
`;
}

export function dockerCompose(projectName: string, db: DjangoDb): string {
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
      # Inside the compose network the host is the service name, not localhost.
      POSTGRES_HOST: db
    depends_on:
      db:
        # Not just "started": the API would otherwise race the database on first query.
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

export function readmeMd(projectName: string, structure: DjangoStructure, db: DjangoDb): string {
  return `# ${projectName}

A Django REST service generated with [agbar](https://github.com/Oluiy/aggregator),
using the **${structure}** structure. See [ARCHITECTURE.md](ARCHITECTURE.md) for why it
is shaped this way.

## Run it

\`\`\`bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python manage.py test            # the generated tests should pass
python manage.py migrate
python manage.py runserver
\`\`\`

\`manage.py\` sets \`DJANGO_DEBUG=true\` for local work. Anywhere else, set
\`DJANGO_SECRET_KEY\` (see \`.env.example\`) - startup fails without it.
${db === "postgres" ? "\nPostgreSQL: `docker compose up -d db`, then set `POSTGRES_PASSWORD` in `.env`.\n" : ""}
## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | \`/health\` | Liveness. Outside the version prefix, because probes use a fixed path. |
| GET | \`/api/v1/health/ready\` | Readiness - actually queries the database. |
| POST | \`/api/v1/items\` | Create an item. |
| GET | \`/api/v1/items?limit=50&offset=0\` | List items, paginated and capped at 200. |
| GET | \`/api/v1/items/<id>\` | Get one item, 404 when missing. |

## Django's own commands

\`\`\`bash
python manage.py startapp orders apps/orders   # a new app (create the folder first)
python manage.py makemigrations                # after changing a model
python manage.py createsuperuser               # then visit /admin/
\`\`\`

## Grade it

\`\`\`bash
agbar check
\`\`\`
`;
}

export function architectureMd(projectName: string, structure: DjangoStructure): string {
  const layout =
    structure === "service-layer"
      ? `\`\`\`
config/            project: settings, urls, wsgi/asgi
apps/
  core/            health endpoints, pagination
  items/
    models.py      tables
    serializers.py request/response validation
    services.py    every write
    selectors.py   every read
    views.py       HTTP only - no ORM calls
    urls.py
\`\`\`

**Why:** views stay thin. Writes go through \`services.py\` and reads through
\`selectors.py\`, so the rules are not smeared across serializers, views and ORM calls
scattered through the codebase. The same service can back a view, a management command
or a queue consumer. The cost is two files per app that a simple CRUD service does not
need - worth it once there are rules beyond "save this".`
      : `\`\`\`
config/            project: settings, urls, wsgi/asgi
apps/
  core/            health endpoints, pagination
  items/
    models.py      tables
    serializers.py request/response validation
    views.py       generic views - DRF supplies list/create/retrieve
    urls.py
\`\`\`

**Why:** idiomatic Django, with the fewest files. DRF's generic views already do list,
create and retrieve, so there is no code to write for them. Start here; move to the
*service-layer* structure when views begin to carry real business rules.`;

  return `# Architecture

${projectName}, generated with agbar. This records the decisions so the next person
does not have to reverse-engineer them.

## Structure: ${structure}

${layout}

## Decisions already made for you

| Decision | Why |
|---|---|
| **Listing is paginated and capped at 200** | An unbounded list is fine at 200 rows and a timeout at 2 million. \`max_limit\` is enforced by DRF in one place, so no later view can remove it. |
| **Rate limiting is on by default** (DRF throttling) | One misbehaving client or a credential-stuffing bot should not take the service down. Set once in \`REST_FRAMEWORK\`, so every future view is covered. Tune with \`THROTTLE_ANON\` / \`THROTTLE_USER\`. |
| **Liveness and readiness are separate** | \`/health\` answers "am I running?" and never touches the database. \`/api/v1/health/ready\` queries it and returns 503 on failure, so a process that cannot reach its database is pulled from the load balancer. Neither is throttled. |
| **No secret in source** | A missing \`DJANGO_SECRET_KEY\` raises at startup. \`manage.py\` sets \`DJANGO_DEBUG=true\` for local work; \`wsgi.py\` deliberately does not, so a deployed server cannot silently run in debug. |
| **Migrations are committed** | The initial migration is written out, and a test fails if the model and migrations drift apart. |
| **gunicorn in the image, not \`runserver\`** | \`runserver\` is a development server and is explicitly not for production. The container runs non-root with a health check. |
| **Dependencies are lower bounds** | \`django>=5.2\` is the LTS and runs on Python 3.10+; Django 6 needs 3.12+. Pip picks what your interpreter supports. Commit your lock file for reproducibility. |

## Where to add things

| You want to... | Do this |
|---|---|
| Add a feature | \`mkdir apps/orders && python manage.py startapp orders apps/orders\`, set \`name = "apps.orders"\` in its \`apps.py\`, add it to \`INSTALLED_APPS\`, and include its urls in \`config/urls.py\`. |
| Change the schema | Edit the model, run \`python manage.py makemigrations\`, read the generated file, then \`migrate\`. |
| Call another service | Build the client with \`settings.REQUEST_TIMEOUT_SECONDS\`. A client with no timeout lets one slow dependency hold a worker open indefinitely. |
| Add auth | DRF's \`DEFAULT_AUTHENTICATION_CLASSES\` and \`DEFAULT_PERMISSION_CLASSES\`. Not included: the right choice depends on your identity provider. |

## What this scaffold deliberately does not include

Authentication, caching, tracing, and a task queue. Each is a real decision that depends
on your deployment, and a wrong default is worse than an obvious gap. Run
\`agbar check\` to see what it still flags, with the reasoning.
`;
}
