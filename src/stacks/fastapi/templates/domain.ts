import type { FastApiPaths } from "../layout.js";

/**
 * The example feature: one Item, modelled end to end. It exists so the generated
 * project is a working reference you can copy for a real feature, rather than an
 * empty folder tree.
 *
 * In "clean", the domain entity and the repository interface are separate files
 * and SQLAlchemy appears only in infrastructure - which is the whole reason that
 * layout costs two extra files.
 */

export function modelPy(paths: FastApiPaths): string {
  return `from datetime import datetime, timezone

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from ${paths.baseMod} import Base


class Item(Base):
    """The items table. SQLAlchemy 2.x typed mappings: the annotation is the column type."""

    __tablename__ = "items"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Indexed because listing and lookup both sort or filter on it; an unindexed
    # name column is the first thing to hurt once the table grows.
    name: Mapped[str] = mapped_column(String(200), index=True)
    description: Mapped[str | None] = mapped_column(String(1000), default=None)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        # Timezone-aware and set by the database, so rows written by different
        # processes stay comparable.
        server_default=func.now(),
        default=lambda: datetime.now(timezone.utc),
    )
`;
}

export function entityPy(): string {
  return `from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class Item:
    """
    The domain's own Item: a plain object with no SQLAlchemy, no Pydantic, no FastAPI.

    Nothing in this package imports outward. That is what lets the business rules be
    tested without a database and keeps a schema change from rippling into them.
    """

    name: str
    description: str | None = None
    id: int | None = None
    created_at: datetime | None = None
`;
}

export function repoPortPy(paths: FastApiPaths): string {
  return `from typing import Protocol

from ${paths.entityMod} import Item


class ItemRepository(Protocol):
    """
    What the application layer needs from storage, declared by the domain rather
    than by the database. Infrastructure implements this; a test can implement it
    with a dict. A Protocol (not an ABC) keeps implementations from having to
    import this file at all.
    """

    def add(self, item: Item) -> Item: ...

    def get(self, item_id: int) -> Item | None: ...

    def list(self, limit: int, offset: int) -> tuple[list[Item], int]: ...
`;
}

export function schemaPy(): string {
  return `from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ItemCreate(BaseModel):
    """Request body. Validated at the edge, so nothing invalid reaches the service."""

    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1000)


class ItemRead(BaseModel):
    """Response body. Declared separately from the request so adding an internal
    field to the model never leaks it to clients by accident."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    created_at: datetime


class ItemPage(BaseModel):
    """
    A page of items, never the whole table.

    Returning an unbounded list is fine on 200 rows and a timeout on 2 million, so
    the envelope is the default shape here rather than something to add later.
    """

    items: list[ItemRead]
    total: int
    limit: int
    offset: int
`;
}

export function repositoryPy(paths: FastApiPaths, isClean: boolean): string {
  if (isClean) {
    return `from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ${paths.entityMod} import Item
from ${paths.modelMod} import Item as ItemRow


def _to_entity(row: ItemRow) -> Item:
    """The mapping that keeps SQLAlchemy out of the domain."""
    return Item(id=row.id, name=row.name, description=row.description, created_at=row.created_at)


class SqlAlchemyItemRepository:
    """Implements the domain's ItemRepository protocol. Nothing else knows this exists."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def add(self, item: Item) -> Item:
        row = ItemRow(name=item.name, description=item.description)
        self._session.add(row)
        self._session.commit()
        self._session.refresh(row)
        return _to_entity(row)

    def get(self, item_id: int) -> Item | None:
        row = self._session.get(ItemRow, item_id)
        return None if row is None else _to_entity(row)

    def list(self, limit: int, offset: int) -> tuple[list[Item], int]:
        total = self._session.scalar(select(func.count()).select_from(ItemRow)) or 0
        rows = self._session.scalars(select(ItemRow).order_by(ItemRow.id).limit(limit).offset(offset)).all()
        return [_to_entity(row) for row in rows], total
`;
  }

  return `from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ${paths.modelMod} import Item


class ItemRepository:
    """
    Every query against the items table lives here. Keeping SQL in one place is what
    makes "is this query indexed?" a question you can answer by reading one file.
    """

    def __init__(self, session: Session) -> None:
        self._session = session

    def add(self, item: Item) -> Item:
        self._session.add(item)
        self._session.commit()
        self._session.refresh(item)
        return item

    def get(self, item_id: int) -> Item | None:
        return self._session.get(Item, item_id)

    def list(self, limit: int, offset: int) -> tuple[list[Item], int]:
        """One count and one bounded page - never SELECT * with no LIMIT."""
        total = self._session.scalar(select(func.count()).select_from(Item)) or 0
        rows = self._session.scalars(select(Item).order_by(Item.id).limit(limit).offset(offset)).all()
        return list(rows), total
`;
}

export function servicePy(paths: FastApiPaths, isClean: boolean): string {
  const itemImport = isClean ? paths.entityMod : paths.modelMod;
  // In "clean" the repository is named by the domain's Protocol; elsewhere the
  // service imports the concrete class directly.
  const repoImport = isClean ? paths.repoPortMod : paths.repoMod;

  return `from ${itemImport} import Item
from ${repoImport} import ItemRepository


class ItemNotFoundError(Exception):
    """Raised instead of returning None, so the caller cannot forget the missing case."""

    def __init__(self, item_id: int) -> None:
        super().__init__(f"Item {item_id} does not exist")
        self.item_id = item_id


class ItemService:
    """
    The business rules. Takes a repository rather than a session, so these rules can
    be tested against a fake with no database - and so the rules never grow SQL.
    No HTTP types appear here either: raising ItemNotFoundError, not HTTPException,
    is what lets this same service back a CLI or a queue consumer later.
    """

    def __init__(self, repository: ItemRepository) -> None:
        self._repository = repository

    def create(self, name: str, description: str | None) -> Item:
        return self._repository.add(Item(name=name, description=description))

    def get(self, item_id: int) -> Item:
        item = self._repository.get(item_id)
        if item is None:
            raise ItemNotFoundError(item_id)
        return item

    def list(self, limit: int, offset: int) -> tuple[list[Item], int]:
        return self._repository.list(limit=limit, offset=offset)
`;
}
