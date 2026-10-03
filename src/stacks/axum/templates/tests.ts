import { toSnake } from "../layout.js";
import type { AxumDb } from "../types.js";

/**
 * tests/api.rs: full HTTP tests driven through the router in-process with
 * `tower::ServiceExt::oneshot` - no socket, no port, no server to start.
 *
 * SQLite runs against an in-memory database, so `cargo test` passes on a fresh clone.
 * PostgreSQL needs a real server, so those tests are #[ignore]d until
 * TEST_DATABASE_URL is set (`cargo test -- --ignored`); the service's unit tests run
 * either way, since they use a fake repository.
 */
export function apiTestsRs(projectName: string, db: AxumDb): string {
  const crate = toSnake(projectName);
  const ignore = db === "postgres" ? `#[ignore = "needs a running PostgreSQL: set TEST_DATABASE_URL, then cargo test -- --ignored"]\n` : "";

  const setup =
    db === "sqlite"
      ? `async fn test_app() -> Router {
    // One connection: every connection to "sqlite::memory:" is its own empty database,
    // so a pool of several would lose the tables the migration just created.
    let pool = SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
    db::migrate(&pool).await.unwrap();
    app(AppState::new(pool))
}`
      : `async fn test_app() -> Router {
    let url = std::env::var("TEST_DATABASE_URL").expect("TEST_DATABASE_URL must point at a PostgreSQL database");
    let pool = db::connect(&url).await.unwrap();
    db::migrate(&pool).await.unwrap();
    app(AppState::new(pool))
}`;

  const imports = db === "sqlite" ? "use sqlx::sqlite::SqlitePoolOptions;\n" : "";

  const test = (name: string, body: string) => `${ignore}#[tokio::test]\nasync fn ${name}() {\n${body}\n}\n`;

  return `use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use http_body_util::BodyExt;
use serde_json::{json, Value};
${imports}use tower::ServiceExt;

use ${crate}::{app, db, state::AppState};

${setup}

async fn send(app: &Router, method: &str, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json")
        .body(body.map_or_else(Body::empty, |value| Body::from(value.to_string())))
        .unwrap();

    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

${test(
  "liveness_is_unversioned",
  `    // Probes point at a fixed path, so /health must not move when the API version does.
    let (status, body) = send(&test_app().await, "GET", "/health", None).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "ok");`
)}
${test(
  "readiness_checks_the_database",
  `    // Readiness has to actually reach the database, not return 200 blindly.
    let (status, body) = send(&test_app().await, "GET", "/api/v1/health/ready", None).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["database"], "ok");`
)}
${test(
  "create_then_read_an_item",
  `    let app = test_app().await;

    let (status, created) = send(&app, "POST", "/api/v1/items", Some(json!({ "name": "first", "description": "hello" }))).await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, fetched) = send(&app, "GET", &format!("/api/v1/items/{}", created["id"]), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(fetched["name"], "first");`
)}
${test(
  "a_missing_item_is_404_not_500",
  `    let (status, _) = send(&test_app().await, "GET", "/api/v1/items/999999", None).await;

    assert_eq!(status, StatusCode::NOT_FOUND);`
)}
${test(
  "a_blank_name_is_rejected",
  `    let (status, _) = send(&test_app().await, "POST", "/api/v1/items", Some(json!({ "name": "   " }))).await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);`
)}
${test(
  "listing_is_paginated_and_capped",
  `    let app = test_app().await;
    for name in ["a", "b", "c"] {
        send(&app, "POST", "/api/v1/items", Some(json!({ "name": name }))).await;
    }

    let (status, page) = send(&app, "GET", "/api/v1/items?limit=2&offset=0", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(page["items"].as_array().unwrap().len(), 2, "limit must actually bound the response");
    assert!(page["total"].as_i64().unwrap() >= 3);

    // An over-large limit is clamped to the ceiling, never honoured.
    let (_, capped) = send(&app, "GET", "/api/v1/items?limit=100000", None).await;
    assert_eq!(capped["limit"], 200);`
)}`;
}
