import { defineConfig } from "vitest/config";

/**
 * The lesson-checker tests run real child processes (`node --test`, and `cargo`
 * for Rust) to prove every lesson's starter fails and its reference fix passes.
 * Alone each takes 1-2 seconds; with ~20 test files running in parallel it takes
 * longer than vitest's default 5 s per test, and a different one failed on every
 * run - a timeout, not a logic bug. This only widens the wait: an assertion that
 * is wrong still fails immediately.
 */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
