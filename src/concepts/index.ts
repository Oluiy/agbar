import { DATA_CONCEPTS } from "./data.js";
import { DESIGN_CONCEPTS } from "./design.js";
import { PERFORMANCE_CONCEPTS } from "./performance.js";
import { RELIABILITY_CONCEPTS } from "./reliability.js";
import { SECURITY_AND_OPS_CONCEPTS } from "./securityAndOps.js";
import { DATA_TRAP_CONCEPTS } from "./trapsData.js";
import { SYSTEM_TRAP_CONCEPTS } from "./trapsSystems.js";
import type { Concept } from "./types.js";

export type { Concept } from "./types.js";

/**
 * Reliability, security, and design concepts most tutorials skip - the gap
 * between "an API that works" and "a system that survives production, and that
 * a person can still change afterwards."
 *
 * Grouped into one file per theme rather than one flat list, so adding a concept
 * means opening the file it belongs to. The order here is the order they're
 * listed and rendered in, deliberately: design first, because structure is what
 * decides whether any of the rest can be changed later.
 *
 * Unlike the Decisions in explain.ts, these aren't tied to code agbar
 * generated - they're rendered into LEVELING-UP.md honestly framed as "not here
 * yet, but you'll need it."
 */
export const BACKEND_CONCEPTS: Concept[] = [
  ...DESIGN_CONCEPTS,
  ...RELIABILITY_CONCEPTS,
  ...PERFORMANCE_CONCEPTS,
  ...DATA_CONCEPTS,
  ...SECURITY_AND_OPS_CONCEPTS,
  ...DATA_TRAP_CONCEPTS,
  ...SYSTEM_TRAP_CONCEPTS,
];
