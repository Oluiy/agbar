import type { FastApiPaths } from "../layout.js";
import type { FastApiDb } from "../types.js";

/** The HTTP edge: routers, and the one place HTTP status codes are chosen. */

export function healthRoutePy(paths: FastApiPaths, db: FastApiDb): string {
  if (db === "none") {
    return `from fastapi import APIRouter

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/ready", summary="Readiness probe")
def readiness() -> dict[str, str]:
    """
    Liveness ("am I running?") lives unversioned at /health in main.py. Readiness
    ("can I serve traffic?") belongs here, because what it must check grows with
    the app - add each dependency you cannot serve without.
    """
    return {"status": "ready"}
`;
  }

  return `from fastapi import APIRouter, Response, status
from sqlalchemy import text

from ${paths.depsMod} import SessionDep

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/ready", summary="Readiness probe")
def readiness(session: SessionDep, response: Response) -> dict[str, str]:
    """
    Liveness ("am I running?") lives unversioned at /health in main.py. Readiness
    means "can I serve traffic?", so it actually touches the database: a process
    that is up but cannot reach its database should be pulled out of the pool, not
    sent requests. Returns 503 so an orchestrator acts on it.
    """
    try:
        session.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001 - any failure to reach the db means not ready
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "not ready", "database": "unreachable"}
    return {"status": "ready", "database": "ok"}
`;
}

export function itemsRoutePy(paths: FastApiPaths): string {
  return `from fastapi import APIRouter, HTTPException, Query, status

from ${paths.depsMod} import ItemServiceDep
from ${paths.schemaMod} import ItemCreate, ItemPage, ItemRead
from ${paths.serviceMod} import ItemNotFoundError

router = APIRouter(prefix="/items", tags=["items"])


@router.post("", response_model=ItemRead, status_code=status.HTTP_201_CREATED, summary="Create an item")
def create_item(payload: ItemCreate, service: ItemServiceDep) -> ItemRead:
    item = service.create(name=payload.name, description=payload.description)
    return ItemRead.model_validate(item)


@router.get("", response_model=ItemPage, summary="List items (paginated)")
def list_items(
    service: ItemServiceDep,
    # Bounded by the signature, not by convention: le=200 means no client can ask
    # for the whole table, however the handler is later edited.
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> ItemPage:
    items, total = service.list(limit=limit, offset=offset)
    return ItemPage(
        items=[ItemRead.model_validate(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{item_id}", response_model=ItemRead, summary="Get one item")
def get_item(item_id: int, service: ItemServiceDep) -> ItemRead:
    try:
        item = service.get(item_id)
    except ItemNotFoundError:
        # Translating the domain error into HTTP happens here and only here, which
        # is what keeps the service reusable outside a web request.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found") from None
    return ItemRead.model_validate(item)
`;
}

export function apiRouterPy(paths: FastApiPaths, db: FastApiDb): string {
  const imports =
    db === "none"
      ? `from ${paths.healthRouteMod} import router as health_router`
      : `from ${paths.healthRouteMod} import router as health_router
from ${paths.itemsRouteMod} import router as items_router`;

  const includes =
    db === "none"
      ? `api_router.include_router(health_router)`
      : `api_router.include_router(health_router)
api_router.include_router(items_router)`;

  return `from fastapi import APIRouter

${imports}

# One aggregate router mounted under the version prefix in main.py. Adding a feature
# means adding one line here, and the version prefix is decided in exactly one place.
api_router = APIRouter()

${includes}
`;
}
