/** The shapes the Axum adapter's prompts, validation and generators all agree on. */

/**
 * Both produce the same API. The difference is the direction dependencies point.
 */
export type AxumStructure =
  // src/items/{entity,repository,service,handlers}.rs - one feature folder. The
  // entity derives serde and sqlx traits directly, which is idiomatic Rust and the
  // fewest moving parts.
  | "layered"
  // domain/ (plain structs + the repository trait it needs), application/ (service),
  // infrastructure/ (the sqlx implementation), api/ (handlers + response DTOs).
  // domain/ imports nothing from sqlx, serde or axum.
  | "clean";

export type AxumDb = "sqlite" | "postgres";

export interface AxumAddons {
  structure: AxumStructure;
  db: AxumDb;
  includeDocker: boolean;
  /** Use `cargo new` and `cargo add` (resolving current versions) instead of writing Cargo.toml by hand. */
  useCli: boolean;
  /** Run `cargo test` after generating and report the result. */
  install: boolean;
}

export const AXUM_STRUCTURES: AxumStructure[] = ["layered", "clean"];
export const AXUM_DBS: AxumDb[] = ["sqlite", "postgres"];
