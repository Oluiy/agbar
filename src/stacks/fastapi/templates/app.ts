import type { FastApiPaths } from "../layout.js";
import type { FastApiDb } from "../types.js";

/** The application wiring: entrypoint, settings, database session, DI providers. */

export function mainPy(paths: FastApiPaths, projectName: string, db: FastApiDb): string {
  const hasDb = db !== "none";
  const dbImports = hasDb ? `from ${paths.sessionMod} import init_db\n` : "";
  const lifespan = hasDb
    ? `@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Alembic owns the schema (see migrations/). This only ensures a freshly
    # cloned project runs before anyone has applied a migration.
    init_db()
    yield


`
    : "";
  const lifespanArg = hasDb ? ", lifespan=lifespan" : "";
  const asyncImports = hasDb ? "from collections.abc import AsyncIterator\nfrom contextlib import asynccontextmanager\n\n" : "";

  return `${asyncImports}from fastapi import FastAPI

from ${paths.apiRouterMod} import api_router
from ${paths.configMod} import settings
${dbImports}

${lifespan}app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    # Every route is namespaced, so /api/v1/items can change without breaking
    # clients already using /api/v1.
    openapi_url=f"{settings.api_prefix}/openapi.json",
    docs_url=f"{settings.api_prefix}/docs"${lifespanArg},
)

app.include_router(api_router, prefix=settings.api_prefix)


@app.get("/health", tags=["health"], summary="Liveness probe")
def health() -> dict[str, str]:
    """Unversioned on purpose: orchestrators and load balancers hit a fixed path."""
    return {"status": "ok", "service": "${projectName}"}
`;
}

export function configPy(projectName: string, db: FastApiDb): string {
  const dbField =
    db === "none"
      ? ""
      : db === "sqlite"
        ? `
    # A file next to the project, so a fresh clone runs with no database server.
    database_url: str = "sqlite:///./${projectName.toLowerCase()}.db"`
        : `
    # No credentials in source: set DATABASE_URL in the environment (.env locally,
    # a secret in deployment). The default points at the docker-compose service.
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/${projectName.toLowerCase()}"`;

  return `from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Configuration read from the environment, with .env as a local convenience.

    Every field is typed, so a malformed value fails at startup with a clear
    message instead of surfacing as a confusing error on the first request.
    """

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "${projectName}"
    api_prefix: str = "/api/v1"${dbField}

    # Outbound HTTP has no timeout by default in most clients, which lets one slow
    # dependency hold a worker open indefinitely. Pass this to every client you build.
    request_timeout_seconds: float = 10.0


settings = Settings()
`;
}

export function basePy(): string {
  return `from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Shared declarative base. Every model inherits from this so Alembic can see it."""
`;
}

export function sessionPy(paths: FastApiPaths, db: FastApiDb): string {
  const sqliteArgs =
    db === "sqlite"
      ? `
# SQLite refuses cross-thread use by default, and FastAPI runs sync endpoints in a
# threadpool - so the check has to be relaxed for this driver only.
connect_args: dict[str, object] = {"check_same_thread": False}`
      : `
connect_args: dict[str, object] = {}`;

  const poolArgs =
    db === "postgres"
      ? `
    # Sized deliberately: the default of 5 + 10 overflow is easy to exhaust under
    # load, and pool_pre_ping avoids handing out a connection the server has closed.
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    pool_recycle=1800,`
      : "";

  return `from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from ${paths.baseMod} import Base
from ${paths.configMod} import settings
${sqliteArgs}

engine = create_engine(
    settings.database_url,
    connect_args=connect_args,${poolArgs}
)

SessionFactory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def init_db() -> None:
    """Create any missing tables. Import the models first so they are registered."""
    from ${paths.modelMod} import Item  # noqa: F401  (registers the mapping)

    Base.metadata.create_all(bind=engine)


def get_session() -> Generator[Session, None, None]:
    """
    One session per request, always closed. Yielded rather than returned so FastAPI
    tears it down after the response - and so tests can override just this function.
    """
    with SessionFactory() as session:
        yield session
`;
}

export function depsPy(paths: FastApiPaths, db: FastApiDb, isClean: boolean): string {
  if (db === "none") {
    return `# Shared FastAPI dependencies live here. Nothing to provide yet - add a database
# or an external client and this is where its provider belongs.
`;
  }

  const repoCtor = isClean ? "SqlAlchemyItemRepository(session)" : "ItemRepository(session)";
  const repoName = isClean ? "SqlAlchemyItemRepository" : "ItemRepository";

  return `from typing import Annotated

from fastapi import Depends
from sqlalchemy.orm import Session

from ${paths.repoMod} import ${repoName}
from ${paths.serviceMod} import ItemService
from ${paths.sessionMod} import get_session

# Annotated aliases keep the route signatures readable: a handler asks for
# ItemServiceDep, not a nest of Depends(...) calls.
SessionDep = Annotated[Session, Depends(get_session)]


def get_item_service(session: SessionDep) -> ItemService:
    """Assembles the service for one request. The route never names a concrete repository."""
    return ItemService(${repoCtor})


ItemServiceDep = Annotated[ItemService, Depends(get_item_service)]
`;
}
