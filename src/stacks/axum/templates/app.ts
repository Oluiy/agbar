import type { AxumPaths } from "../layout.js";
import { toKebab, toSnake } from "../layout.js";
import type { AxumDb } from "../types.js";

/** The application shell: entrypoint, config, errors, database, state, health, middleware. */

/**
 * Written only when cargo is unavailable. Caret majors, not pins: cargo resolves the
 * newest compatible release at build time, which is what `cargo add` would have done.
 */
export function fallbackCargoToml(projectName: string, db: AxumDb): string {
  return `[package]
name = "${toKebab(projectName)}"
version = "0.1.0"
edition = "2024"

[dependencies]
axum = "0.8"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
sqlx = { version = "0.9", default-features = false, features = ["runtime-tokio", "${db}", "migrate", "macros"] }
tokio = { version = "1", features = ["rt-multi-thread", "macros", "signal", "net"] }
tower-http = { version = "0.7", features = ["trace", "timeout", "limit"] }
tower_governor = { version = "0.8", default-features = false, features = ["axum"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }

[dev-dependencies]
http-body-util = "0.1"
tower = { version = "0.5", features = ["util"] }
`;
}

export function libRs(paths: AxumPaths): string {
  const mods = ["config", "db", "error", "health", "middleware", "state", ...paths.topModules].sort();
  return `use axum::{routing::get, Router};

${mods.map((m) => `pub mod ${m};`).join("\n")}

use state::AppState;

/**
 * The routes, with no middleware. main.rs wraps this with the timeout, body limit,
 * rate limiter and tracing from middleware.rs - kept apart so tests can drive the
 * router directly (the rate limiter needs a real peer address, which an in-process
 * test request does not have).
 */
pub fn app(state: AppState) -> Router {
    let api = Router::new()
        .route("/health/ready", get(health::readiness))
        .route("/items", get(${paths.handlersMod}::list).post(${paths.handlersMod}::create))
        .route("/items/{id}", get(${paths.handlersMod}::get_one));

    Router::new()
        // Outside the version prefix: probes point at a fixed path, and moving it when
        // the API version changes is how a deploy starts failing its own checks.
        .route("/health", get(health::liveness))
        .nest("/api/v1", api)
        .with_state(state)
}
`;
}

export function mainRs(projectName: string): string {
  return `use std::{error::Error, net::SocketAddr};

use ${toSnake(projectName)}::{app, config::Config, db, middleware, state::AppState};
use tokio::{net::TcpListener, signal};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,tower_http=info")))
        .init();

    // A missing or malformed variable stops the process here, naming the variable,
    // rather than surfacing as a confusing error on the first request.
    let config = Config::from_env()?;

    let pool = db::connect(&config.database_url).await?;
    db::migrate(&pool).await?;

    let router = middleware::apply(app(AppState::new(pool)), &config);

    let listener = TcpListener::bind(("0.0.0.0", config.port)).await?;
    tracing::info!("listening on {}", listener.local_addr()?);

    // ConnectInfo gives the rate limiter each client's address.
    axum::serve(listener, router.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

/// Finish in-flight requests on Ctrl-C or SIGTERM instead of cutting them off, so a
/// deploy does not drop connections mid-response.
async fn shutdown_signal() {
    let ctrl_c = async { signal::ctrl_c().await.expect("install Ctrl-C handler") };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate()).expect("install SIGTERM handler").recv().await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
    tracing::info!("shutting down");
}
`;
}

export function configRs(projectName: string, db: AxumDb): string {
  const dbDefault =
    db === "sqlite"
      ? `        // A file next to the project, so a fresh clone runs with no database server.
        database_url: env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://${toSnake(projectName)}.db?mode=rwc".to_owned()),`
      : `        // No default: a connection string carries a password, and a password in source is
        // a leaked password. Set it in the environment (.env locally, a secret in deployment).
        database_url: env::var("DATABASE_URL").map_err(|_| ConfigError("DATABASE_URL is required".to_owned()))?,`;

  return `use std::{env, fmt, str::FromStr};

/// Configuration read once at startup. Every field is typed, so a bad value fails
/// immediately with the variable named.
#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub database_url: String,
    /// Most HTTP clients and servers have no timeout unless one is set, which lets one
    /// slow dependency hold a worker open indefinitely.
    pub request_timeout_secs: u64,
    pub max_body_bytes: usize,
    pub rate_limit_per_second: u64,
    pub rate_limit_burst: u32,
}

#[derive(Debug)]
pub struct ConfigError(pub String);

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid configuration: {}", self.0)
    }
}

impl std::error::Error for ConfigError {}

fn parse_or<T: FromStr>(name: &str, default: T) -> Result<T, ConfigError> {
    match env::var(name) {
        Ok(raw) => raw.parse().map_err(|_| ConfigError(format!("{name} has an invalid value: {raw:?}"))),
        Err(_) => Ok(default),
    }
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Ok(Self {
            port: parse_or("PORT", 3000)?,
${dbDefault}
            request_timeout_secs: parse_or("REQUEST_TIMEOUT_SECS", 10)?,
            max_body_bytes: parse_or("MAX_BODY_BYTES", 1_048_576)?,
            rate_limit_per_second: parse_or("RATE_LIMIT_PER_SECOND", 10)?,
            rate_limit_burst: parse_or("RATE_LIMIT_BURST", 50)?,
        })
    }
}
`;
}

export function errorRs(): string {
  return `use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

/// What a handler can fail with. The only place HTTP status codes are chosen, so the
/// service layer stays free of HTTP and can back a CLI or a queue consumer too.
#[derive(Debug)]
pub enum ApiError {
    NotFound(String),
    BadRequest(String),
    /// The detail is logged, never sent: an internal error message can leak table
    /// names, SQL, or paths to whoever triggered it.
    Internal(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            Self::NotFound(message) => (StatusCode::NOT_FOUND, message),
            Self::BadRequest(message) => (StatusCode::UNPROCESSABLE_ENTITY, message),
            Self::Internal(detail) => {
                tracing::error!(%detail, "internal error");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal server error".to_owned())
            }
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}
`;
}

export function dbRs(db: AxumDb): string {
  if (db === "sqlite") {
    return `use std::{str::FromStr, time::Duration};

use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    SqlitePool,
};

/// One alias for the pool type, so the rest of the code never names the database.
pub type DbPool = SqlitePool;

pub async fn connect(url: &str) -> Result<DbPool, sqlx::Error> {
    // Foreign keys are off by default in SQLite, which silently ignores a constraint
    // the schema declares.
    let options = SqliteConnectOptions::from_str(url)?.foreign_keys(true);
    SqlitePoolOptions::new()
        .max_connections(5)
        // Waiting forever for a connection is how a slow query becomes an outage.
        .acquire_timeout(Duration::from_secs(5))
        .connect_with(options)
        .await
}

/// Applies migrations/ at startup. They are embedded in the binary, so the image needs
/// no migration files at run time.
pub async fn migrate(pool: &DbPool) -> Result<(), sqlx::migrate::MigrateError> {
    sqlx::migrate!("./migrations").run(pool).await
}
`;
  }

  return `use std::time::Duration;

use sqlx::{postgres::PgPoolOptions, PgPool};

/// One alias for the pool type, so the rest of the code never names the database.
pub type DbPool = PgPool;

pub async fn connect(url: &str) -> Result<DbPool, sqlx::Error> {
    PgPoolOptions::new()
        // Sized deliberately: a pool larger than the database allows exhausts its
        // connection limit, and one too small queues requests behind each other.
        .max_connections(10)
        // Waiting forever for a connection is how a slow query becomes an outage.
        .acquire_timeout(Duration::from_secs(5))
        .connect(url)
        .await
}

/// Applies migrations/ at startup. They are embedded in the binary, so the image needs
/// no migration files at run time.
pub async fn migrate(pool: &DbPool) -> Result<(), sqlx::migrate::MigrateError> {
    sqlx::migrate!("./migrations").run(pool).await
}
`;
}

export function stateRs(paths: AxumPaths): string {
  return `use std::sync::Arc;

use ${paths.serviceMod}::ItemService;
use ${paths.sqlxMod}::SqlxItemRepository;

use crate::db::DbPool;

/// Shared by every handler. Cloning is cheap - a pool handle and an Arc - which is what
/// axum does for each request.
#[derive(Clone)]
pub struct AppState {
    pub pool: DbPool,
    pub items: Arc<ItemService<SqlxItemRepository>>,
}

impl AppState {
    /// The one place a concrete repository is chosen. Swapping the storage means
    /// changing this line; the service and handlers never change.
    pub fn new(pool: DbPool) -> Self {
        let items = Arc::new(ItemService::new(SqlxItemRepository::new(pool.clone())));
        Self { pool, items }
    }
}
`;
}

export function healthRs(): string {
  return `use axum::{extract::State, http::StatusCode, Json};
use serde_json::{json, Value};

use crate::state::AppState;

/// Liveness: "am I running?" Cheap on purpose - it must not touch the database, or a
/// slow database makes the orchestrator restart a perfectly healthy process.
pub async fn liveness() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}

/// Readiness: "can I serve traffic?" - so it actually queries the database. A process
/// that is up but cannot reach its database should be pulled out of the load balancer,
/// not sent requests, which is why this returns 503.
pub async fn readiness(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => (StatusCode::OK, Json(json!({ "status": "ready", "database": "ok" }))),
        Err(error) => {
            tracing::warn!(%error, "readiness check failed");
            (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "status": "not ready", "database": "unreachable" })))
        }
    }
}
`;
}

export function middlewareRs(): string {
  return `use std::{sync::Arc, time::Duration};

use axum::{http::StatusCode, Router};
use tower_governor::{governor::GovernorConfigBuilder, GovernorLayer};
use tower_http::{limit::RequestBodyLimitLayer, timeout::TimeoutLayer, trace::TraceLayer};

use crate::config::Config;

/// Wraps the router in the protections every route needs, set once here so a route
/// added next month is covered without anyone remembering to opt in.
///
/// Layers wrap from the inside out: the last one added sees the request first.
pub fn apply(router: Router, config: &Config) -> Router {
    // Per-client rate limiting: one misbehaving client or a credential-stuffing bot
    // should not be able to take the service down.
    let governor = Arc::new(
        GovernorConfigBuilder::default()
            .per_second(config.rate_limit_per_second)
            .burst_size(config.rate_limit_burst)
            .finish()
            .expect("rate limit settings must be non-zero"),
    );

    router
        // A request body no one asked for is memory the server pays for.
        .layer(RequestBodyLimitLayer::new(config.max_body_bytes))
        // Bounds how long any handler can hold a worker, whatever it is waiting on.
        .layer(TimeoutLayer::with_status_code(StatusCode::REQUEST_TIMEOUT, Duration::from_secs(config.request_timeout_secs)))
        .layer(GovernorLayer::new(governor))
        .layer(TraceLayer::new_for_http())
}
`;
}
