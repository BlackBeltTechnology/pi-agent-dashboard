/**
 * Canonical operator set and aliases, shared by the CNF evaluator and the
 * diagnostics pass so both agree on what "recognised" means.
 */
import type { Operator } from "../schema/types.js";

/** The eight documented operators. */
export const CANONICAL_OPERATORS = [
  "equals",
  "notEquals",
  "contains",
  "notContains",
  "greaterThan",
  "greaterThanOrEquals",
  "lessThan",
  "lessThanOrEquals",
] as const;

/** Undocumented but genuine aliases; accepted silently. */
export const OPERATOR_ALIASES: Record<string, Operator> = {
  gte: "greaterThanOrEquals",
  lte: "lessThanOrEquals",
};

export const ORDERING_OPERATORS = new Set<string>([
  "greaterThan",
  "greaterThanOrEquals",
  "lessThan",
  "lessThanOrEquals",
]);

const RECOGNISED = new Set<string>([...CANONICAL_OPERATORS, ...Object.keys(OPERATOR_ALIASES)]);

export function isRecognisedOperator(op: string): boolean {
  return RECOGNISED.has(op);
}

/** Resolve aliases; unknown operators resolve to `equals` (upstream fallback). */
export function resolveOperator(op: string): Operator {
  if ((CANONICAL_OPERATORS as readonly string[]).includes(op)) return op as Operator;
  if (op in OPERATOR_ALIASES) return OPERATOR_ALIASES[op];
  return "equals";
}
