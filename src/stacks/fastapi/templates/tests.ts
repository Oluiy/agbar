import type { FastApiPaths } from "../layout.js";
import type { FastApiDb } from "../types.js";

/**
 * The generated tests. They have to pass on a fresh clone with no database server
 * running, or "it's a working project" is a claim rather than a fact - so they run
 * against an in-memory SQLite database and override the session dependency.
 */

export function conftestPy(paths: FastApiPaths, db: FastApiDb): string {
  if (db === "none") {
    return `import pytest
from fastapi.testclient import TestClient

from ${paths.mainFile.replace(/\.py$/, "").replace(/\//g, ".")} import app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)
`;
  }

  return `from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from ${paths.baseMod} import Base
from ${paths.mainFile.replace(/\.py$/, "").replace(/\//g, ".")} import app
from ${paths.sessionMod} import get_session


@pytest.fixture()
def client() -> Generator[TestClient, None, None]:
    """
    A client backed by a throwaway in-memory database.

    StaticPool keeps every connection pointed at the same in-memory database - the
    default pool would hand out a fresh, empty one per connection and the tables
    would vanish. TestClient is deliberately not used as a context manager here, so
    the app's lifespan (which would touch the real database) never runs.
    """
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestSessionFactory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_session() -> Generator[Session, None, None]:
        with TestSessionFactory() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    yield TestClient(app)
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
`;
}

export function testHealthPy(db: FastApiDb): string {
  const ready =
    db === "none"
      ? `def test_readiness_reports_ready(client: TestClient) -> None:
    response = client.get("/api/v1/health/ready")

    assert response.status_code == 200
    assert response.json()["status"] == "ready"`
      : `def test_readiness_checks_the_database(client: TestClient) -> None:
    """Readiness must actually reach the database, not just return 200 blindly."""
    response = client.get("/api/v1/health/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready", "database": "ok"}`;

  return `from fastapi.testclient import TestClient


def test_liveness_is_unversioned(client: TestClient) -> None:
    """Probes point at a fixed path, so /health must not move when the API version does."""
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


${ready}
`;
}

export function testItemsPy(): string {
  return `from fastapi.testclient import TestClient

ITEMS = "/api/v1/items"


def test_create_then_read_an_item(client: TestClient) -> None:
    created = client.post(ITEMS, json={"name": "first", "description": "hello"})
    assert created.status_code == 201
    item_id = created.json()["id"]

    fetched = client.get(f"{ITEMS}/{item_id}")
    assert fetched.status_code == 200
    assert fetched.json()["name"] == "first"


def test_missing_item_is_404_not_500(client: TestClient) -> None:
    """The service raises a domain error; the route is what turns it into a 404."""
    response = client.get(f"{ITEMS}/999999")

    assert response.status_code == 404


def test_listing_is_paginated_and_bounded(client: TestClient) -> None:
    for index in range(3):
        client.post(ITEMS, json={"name": f"item-{index}"})

    page = client.get(ITEMS, params={"limit": 2, "offset": 0})
    body = page.json()

    assert page.status_code == 200
    assert body["total"] == 3
    assert len(body["items"]) == 2, "limit must actually bound the response"

    # The cap is enforced by the route signature, so an over-large limit is rejected
    # rather than quietly returning the whole table.
    assert client.get(ITEMS, params={"limit": 10_000}).status_code == 422


def test_blank_name_is_rejected(client: TestClient) -> None:
    assert client.post(ITEMS, json={"name": ""}).status_code == 422
`;
}

export function testServiceUnitPy(paths: FastApiPaths, isClean: boolean): string {
  const itemMod = isClean ? paths.entityMod : paths.modelMod;
  const construct = isClean ? "Item(id=next_id, name=item.name, description=item.description)" : "item";

  return `"""
A unit test with no database and no HTTP: the service takes a repository, so a dict
is a valid one. This is the payoff of the service not knowing about SQLAlchemy.
"""

import pytest

from ${itemMod} import Item
from ${paths.serviceMod} import ItemNotFoundError, ItemService


class FakeItemRepository:
    def __init__(self) -> None:
        self._rows: dict[int, Item] = {}

    def add(self, item: Item) -> Item:
        next_id = len(self._rows) + 1
        stored = ${construct}
        self._rows[next_id] = stored
        return stored

    def get(self, item_id: int) -> Item | None:
        return self._rows.get(item_id)

    def list(self, limit: int, offset: int) -> tuple[list[Item], int]:
        rows = list(self._rows.values())
        return rows[offset : offset + limit], len(rows)


def test_get_raises_a_domain_error_when_missing() -> None:
    service = ItemService(FakeItemRepository())

    with pytest.raises(ItemNotFoundError):
        service.get(1)


def test_create_then_list_returns_the_item() -> None:
    service = ItemService(FakeItemRepository())
    service.create(name="only", description=None)

    items, total = service.list(limit=10, offset=0)

    assert total == 1
    assert items[0].name == "only"
`;
}
