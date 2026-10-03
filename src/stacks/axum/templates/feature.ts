import type { AxumPaths } from "../layout.js";
import type { AxumDb, AxumStructure } from "../types.js";

/**
 * The example feature: one Item, modelled end to end, so the generated project is a
 * working reference to copy rather than an empty folder tree.
 *
 * In "clean", the domain entity is a plain struct and the repository trait is
 * declared by the domain; sqlx and serde appear only in infrastructure and api.
 */

export function modRs(children: string[]): string {
  return `${children.map((c) => `pub mod ${c};`).join("\n")}\n`;
}

export function entityRs(structure: AxumStructure): string {
  if (structure === "clean") {
    return `/// The domain's own Item: a plain struct with no sqlx, no serde and no axum.
///
/// Nothing in domain/ imports outward. That is what lets the rules be tested without a
/// database and keeps a schema or JSON change from rippling into them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Item {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
}

/// An item before storage has assigned it an id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewItem {
    pub name: String,
    pub description: Option<String>,
}
`;
  }

  return `use serde::Serialize;

/// Serialises straight to the JSON response and reads straight from a row - the
/// idiomatic shape for a service this size. Move to the *clean* structure when the
/// domain needs to stop knowing about either.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, sqlx::FromRow)]
pub struct Item {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
}

/// An item before storage has assigned it an id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewItem {
    pub name: String,
    pub description: Option<String>,
}
`;
}

export function repositoryRs(paths: AxumPaths): string {
  return `use std::{fmt, future::Future};

use ${paths.entityMod}::{Item, NewItem};

/// A storage failure. Carries only text: the service layer must not depend on sqlx's
/// error type, or swapping the database would change its signatures.
#[derive(Debug)]
pub struct RepositoryError(pub String);

impl fmt::Display for RepositoryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "storage error: {}", self.0)
    }
}

impl std::error::Error for RepositoryError {}

/// What the service needs from storage, declared here rather than by the database. An
/// implementation can be sqlx, or a Vec in a test.
///
/// Written with explicit \`impl Future + Send\` returns because a bare \`async fn\` in a
/// trait does not promise the future is Send, and axum handlers require it.
pub trait ItemRepository: Send + Sync {
    fn add(&self, item: NewItem) -> impl Future<Output = Result<Item, RepositoryError>> + Send;

    fn find(&self, id: i64) -> impl Future<Output = Result<Option<Item>, RepositoryError>> + Send;

    /// One bounded page and the total, never the whole table.
    fn page(&self, limit: i64, offset: i64) -> impl Future<Output = Result<(Vec<Item>, i64), RepositoryError>> + Send;
}
`;
}

export function sqlxRepositoryRs(paths: AxumPaths, structure: AxumStructure, db: AxumDb): string {
  const p = (n: number) => (db === "postgres" ? `$${n}` : "?");
  const isClean = structure === "clean";

  const rowType = isClean
    ? `
/// The table's row shape. Private to infrastructure: the domain never sees sqlx types.
#[derive(sqlx::FromRow)]
struct ItemRow {
    id: i64,
    name: String,
    description: Option<String>,
}

impl From<ItemRow> for Item {
    fn from(row: ItemRow) -> Self {
        Self { id: row.id, name: row.name, description: row.description }
    }
}
`
    : "";
  const row = isClean ? "ItemRow" : "Item";
  const mapOne = isClean ? ".map(Item::from)" : "";
  const mapMany = isClean ? "rows.into_iter().map(Item::from).collect()" : "rows";

  return `use ${paths.entityMod}::{Item, NewItem};
use ${paths.repositoryMod}::{ItemRepository, RepositoryError};

use crate::db::DbPool;
${rowType}
/// Every query against the items table lives in this file, so "is this query indexed?"
/// is answerable by reading one place.
#[derive(Clone)]
pub struct SqlxItemRepository {
    pool: DbPool,
}

impl SqlxItemRepository {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }
}

fn storage(error: sqlx::Error) -> RepositoryError {
    RepositoryError(error.to_string())
}

impl ItemRepository for SqlxItemRepository {
    async fn add(&self, item: NewItem) -> Result<Item, RepositoryError> {
        // Bound parameters, never string formatting: a name is data, not SQL.
        sqlx::query_as::<_, ${row}>("INSERT INTO items (name, description) VALUES (${p(1)}, ${p(2)}) RETURNING id, name, description")
            .bind(item.name)
            .bind(item.description)
            .fetch_one(&self.pool)
            .await
            .map_err(storage)
            ${isClean ? ".map(Item::from)" : ""}
    }

    async fn find(&self, id: i64) -> Result<Option<Item>, RepositoryError> {
        let row = sqlx::query_as::<_, ${row}>("SELECT id, name, description FROM items WHERE id = ${p(1)}")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(storage)?;
        Ok(row${mapOne})
    }

    async fn page(&self, limit: i64, offset: i64) -> Result<(Vec<Item>, i64), RepositoryError> {
        let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM items").fetch_one(&self.pool).await.map_err(storage)?;
        // LIMIT and OFFSET always: this never reads more rows than were asked for.
        let rows = sqlx::query_as::<_, ${row}>("SELECT id, name, description FROM items ORDER BY id LIMIT ${p(1)} OFFSET ${p(2)}")
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await
            .map_err(storage)?;
        Ok((${mapMany}, total))
    }
}
`;
}

export function serviceRs(paths: AxumPaths): string {
  return `use std::fmt;

use ${paths.entityMod}::{Item, NewItem};
use ${paths.repositoryMod}::{ItemRepository, RepositoryError};

const MAX_NAME_CHARS: usize = 200;

/// What the service can fail with. Plain Rust - no HTTP types - so the same service can
/// back a CLI or a queue consumer; the api layer turns these into status codes.
#[derive(Debug)]
pub enum ItemsError {
    NotFound(i64),
    Invalid(String),
    Storage(RepositoryError),
}

impl fmt::Display for ItemsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound(id) => write!(f, "item {id} does not exist"),
            Self::Invalid(reason) => write!(f, "{reason}"),
            Self::Storage(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for ItemsError {}

impl From<RepositoryError> for ItemsError {
    fn from(error: RepositoryError) -> Self {
        Self::Storage(error)
    }
}

/// The business rules. Generic over the repository, so it is tested with a fake and
/// never sees a database. Static dispatch: no Box, no dyn, no allocation per call.
pub struct ItemService<R> {
    repository: R,
}

impl<R: ItemRepository> ItemService<R> {
    pub fn new(repository: R) -> Self {
        Self { repository }
    }

    pub async fn create(&self, name: String, description: Option<String>) -> Result<Item, ItemsError> {
        let name = name.trim().to_owned();
        if name.is_empty() {
            return Err(ItemsError::Invalid("name must not be blank".to_owned()));
        }
        if name.chars().count() > MAX_NAME_CHARS {
            return Err(ItemsError::Invalid(format!("name must be at most {MAX_NAME_CHARS} characters")));
        }
        Ok(self.repository.add(NewItem { name, description }).await?)
    }

    pub async fn get(&self, id: i64) -> Result<Item, ItemsError> {
        self.repository.find(id).await?.ok_or(ItemsError::NotFound(id))
    }

    pub async fn list(&self, limit: i64, offset: i64) -> Result<(Vec<Item>, i64), ItemsError> {
        Ok(self.repository.page(limit, offset).await?)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    /// No database, no HTTP: the service takes a repository, so a Vec is a valid one.
    #[derive(Default)]
    struct FakeRepository {
        rows: Mutex<Vec<Item>>,
    }

    impl ItemRepository for FakeRepository {
        async fn add(&self, item: NewItem) -> Result<Item, RepositoryError> {
            let mut rows = self.rows.lock().unwrap();
            let stored = Item { id: rows.len() as i64 + 1, name: item.name, description: item.description };
            rows.push(stored.clone());
            Ok(stored)
        }

        async fn find(&self, id: i64) -> Result<Option<Item>, RepositoryError> {
            Ok(self.rows.lock().unwrap().iter().find(|row| row.id == id).cloned())
        }

        async fn page(&self, limit: i64, offset: i64) -> Result<(Vec<Item>, i64), RepositoryError> {
            let rows = self.rows.lock().unwrap();
            let page = rows.iter().skip(offset as usize).take(limit as usize).cloned().collect();
            Ok((page, rows.len() as i64))
        }
    }

    #[tokio::test]
    async fn creates_then_reads_back() {
        let service = ItemService::new(FakeRepository::default());

        let created = service.create("first".to_owned(), None).await.unwrap();

        assert_eq!(service.get(created.id).await.unwrap().name, "first");
    }

    #[tokio::test]
    async fn trims_the_name() {
        let service = ItemService::new(FakeRepository::default());

        assert_eq!(service.create("  padded  ".to_owned(), None).await.unwrap().name, "padded");
    }

    #[tokio::test]
    async fn rejects_a_blank_or_oversized_name() {
        let service = ItemService::new(FakeRepository::default());

        assert!(matches!(service.create("   ".to_owned(), None).await, Err(ItemsError::Invalid(_))));
        assert!(matches!(service.create("x".repeat(201), None).await, Err(ItemsError::Invalid(_))));
    }

    #[tokio::test]
    async fn a_missing_item_is_a_domain_error_not_an_http_one() {
        let service = ItemService::new(FakeRepository::default());

        assert!(matches!(service.get(999).await, Err(ItemsError::NotFound(999))));
    }

    #[tokio::test]
    async fn lists_a_bounded_page_and_the_full_total() {
        let service = ItemService::new(FakeRepository::default());
        for name in ["a", "b", "c"] {
            service.create(name.to_owned(), None).await.unwrap();
        }

        let (page, total) = service.list(2, 0).await.unwrap();

        assert_eq!(page.len(), 2);
        assert_eq!(total, 3);
    }
}
`;
}

export function handlersRs(paths: AxumPaths, structure: AxumStructure): string {
  const isClean = structure === "clean";
  const dto = isClean
    ? `
/// The JSON shape of an item. Separate from the domain's Item, so a field added to the
/// domain is not exposed to clients until someone chooses to expose it here.
#[derive(Serialize)]
pub struct ItemResponse {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
}

impl From<Item> for ItemResponse {
    fn from(item: Item) -> Self {
        Self { id: item.id, name: item.name, description: item.description }
    }
}
`
    : "";
  const out = isClean ? "ItemResponse" : "Item";
  const toOut = isClean ? ".into()" : "";
  const pageItems = isClean ? "items.into_iter().map(ItemResponse::from).collect()" : "items";

  return `use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};

use ${paths.entityMod}::Item;
use ${paths.serviceMod}::ItemsError;

use crate::{error::ApiError, state::AppState};

/// Hard ceiling on a page, enforced here for every client: asking for limit=100000 gets
/// 200 rows, and no later edit to a query can quietly remove the cap.
const MAX_LIMIT: i64 = 200;
const DEFAULT_LIMIT: i64 = 50;

#[derive(Deserialize)]
pub struct CreateItem {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Deserialize)]
pub struct ListParams {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}
${dto}
#[derive(Serialize)]
pub struct ItemPage {
    pub items: Vec<${out}>,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
}

/// The one place a domain error becomes an HTTP status.
fn to_api_error(error: ItemsError) -> ApiError {
    match error {
        ItemsError::NotFound(_) => ApiError::NotFound("item not found".to_owned()),
        ItemsError::Invalid(reason) => ApiError::BadRequest(reason),
        ItemsError::Storage(error) => ApiError::Internal(error.to_string()),
    }
}

pub async fn create(State(state): State<AppState>, Json(body): Json<CreateItem>) -> Result<(StatusCode, Json<${out}>), ApiError> {
    let item = state.items.create(body.name, body.description).await.map_err(to_api_error)?;
    Ok((StatusCode::CREATED, Json(item${toOut})))
}

pub async fn list(State(state): State<AppState>, Query(params): Query<ListParams>) -> Result<Json<ItemPage>, ApiError> {
    let limit = params.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let offset = params.offset.unwrap_or(0).max(0);
    let (items, total) = state.items.list(limit, offset).await.map_err(to_api_error)?;
    Ok(Json(ItemPage { items: ${pageItems}, total, limit, offset }))
}

pub async fn get_one(State(state): State<AppState>, Path(id): Path<i64>) -> Result<Json<${out}>, ApiError> {
    let item = state.items.get(id).await.map_err(to_api_error)?;
    Ok(Json(item${toOut}))
}
`;
}

export function migrationSql(db: AxumDb): string {
  const id = db === "postgres" ? "BIGSERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";
  return `-- The first migration. Every later change is a new numbered file here, applied in
-- order at startup and recorded in the _sqlx_migrations table.
CREATE TABLE items (
    id ${id},
    name TEXT NOT NULL,
    description TEXT
);

-- Listing sorts and filters on name, and an unindexed column is the first thing to hurt
-- once the table grows.
CREATE INDEX idx_items_name ON items (name);
`;
}
