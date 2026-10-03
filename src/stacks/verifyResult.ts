/**
 * The result of "did the project we just generated actually install and pass its
 * tests?", reported by every adapter that can verify its own output. Returned from
 * `StackAdapter.generate` (see GenerateResult), not stashed anywhere: a module-level
 * variable here made two concurrent generations overwrite each other's result and made
 * every adapter's behaviour depend on hidden shared state.
 */
export interface VerifyResult {
  /** Undefined when nothing could be run at all (no toolchain), so the caller can say so honestly. */
  installed?: boolean;
  testsPassed?: boolean;
  /** How it was installed, for the report: "npm", "uv", "venv + pip". */
  via?: string;
  detail: string;
}
