import { DATABASE_RULES } from "./databaseRules.js";
import { OPERATIONAL_RULES } from "./operationalRules.js";
import { SECURITY_RULES } from "./securityRules.js";
import { STRUCTURAL_RULES } from "./structuralRules.js";
import type { Rule } from "./types.js";

/**
 * The full rule set, in two halves that answer different questions:
 * operational ("will it survive traffic?") and structural ("can a person still
 * change it?"). Adding a rule means editing one of those files, not this one.
 *
 * `kind` is tagged here rather than in every rule literal - it's determined
 * entirely by which file a rule lives in, so repeating it 11 times would just
 * be a place for one of those copies to drift from where the rule actually is.
 */
export const RULES: Rule[] = [
  ...OPERATIONAL_RULES.map((r) => ({ ...r, kind: "operational" as const })),
  ...DATABASE_RULES.map((r) => ({ ...r, kind: "operational" as const })),
  ...SECURITY_RULES.map((r) => ({ ...r, kind: "operational" as const })),
  ...STRUCTURAL_RULES.map((r) => ({ ...r, kind: "structural" as const })),
];
