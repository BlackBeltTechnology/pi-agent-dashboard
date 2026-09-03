/**
 * CNF evaluator shared by `conditionalRules` (field/section) and
 * `crossFieldRules` (root). A rule is satisfied when EVERY group holds AT LEAST
 * ONE satisfied condition — AND between groups, OR within a group. An empty
 * `andGroups`, or any empty condition group, evaluates as not satisfied.
 *
 * Operator semantics are taken from the reference renderer (design D15), not
 * from documentation: `contains` is a case-insensitive substring test on the
 * stringified operands; ordering is a numeric→date→locale-string fallback;
 * an undefined operand makes every ordering operator false; an unrecognised
 * operator falls back to `equals`.
 */
import type {
  AnswerValue,
  Condition,
  ConditionalRule,
  ConditionGroup,
  Diagnostic,
  Operator,
} from "../schema/types.js";
import { isRecognisedOperator, resolveOperator } from "./operators.js";

export interface EvalContext {
  /** Live answer for a field key, or `undefined` when unanswered. */
  getAnswer(key: string): AnswerValue | undefined;
  /** Optional sink for diagnostics discovered during evaluation. */
  reportDiagnostic?(d: Diagnostic): void;
}

export interface ConditionResult {
  condition: Condition;
  resolvedOperator: Operator;
  leftValue: unknown;
  rightValue: unknown;
  satisfied: boolean;
}

export interface GroupResult {
  satisfied: boolean;
  conditions: ConditionResult[];
}

export interface RuleEvaluation {
  satisfied: boolean;
  groups: GroupResult[];
}

// ---------------------------------------------------------------------------
// Coercion helpers
// ---------------------------------------------------------------------------

function toStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.join(",");
  return String(v);
}

/** Number coercion that rejects empty string and non-finite values. */
function toNum(v: unknown): number | null {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Three-tier ordinal comparison. Returns a signed number, or `undefined` when
 * either operand is `undefined` (indeterminate — every ordering operator false).
 */
export function compareOrdinal(left: unknown, right: unknown): number | undefined {
  if (left === undefined || right === undefined) return undefined;

  // Tier 1: numeric (neither empty string, both finite numbers).
  const ln = toNum(left);
  const rn = toNum(right);
  if (left !== "" && right !== "" && ln !== null && rn !== null) {
    return ln === rn ? 0 : ln < rn ? -1 : 1;
  }

  // Tier 2: chronological.
  const ld = Date.parse(toStr(left));
  const rd = Date.parse(toStr(right));
  if (!Number.isNaN(ld) && !Number.isNaN(rd)) {
    return ld === rd ? 0 : ld < rd ? -1 : 1;
  }

  // Tier 3: locale-aware string comparison.
  return toStr(left).localeCompare(toStr(right));
}

// ---------------------------------------------------------------------------
// Single-condition evaluation
// ---------------------------------------------------------------------------

export function evaluateCondition(condition: Condition, ctx: EvalContext): ConditionResult {
  const rawOp = String(condition.operator);
  const resolvedOperator = resolveOperator(rawOp);

  if (!isRecognisedOperator(rawOp)) {
    ctx.reportDiagnostic?.({
      severity: "warning",
      code: "unrecognised-operator",
      message: `Operator "${rawOp}" is unrecognised; evaluating as equality.`,
      path: condition.dependentFieldKey,
    });
  }

  const leftValue = ctx.getAnswer(condition.dependentFieldKey);

  // Resolve the right operand per compareMode.
  let rightValue: unknown;
  if (condition.compareMode === "field") {
    // An absent compareToFieldKey or an unanswered field yields undefined, which
    // makes ordering indeterminate and equality compare against "". Dangling
    // field references are surfaced by `diagnose`, not re-reported here.
    rightValue = condition.compareToFieldKey
      ? ctx.getAnswer(condition.compareToFieldKey)
      : undefined;
  } else {
    rightValue = condition.equalsValue;
  }

  const satisfied = applyOperator(resolvedOperator, leftValue, rightValue);
  return { condition, resolvedOperator, leftValue, rightValue, satisfied };
}

function applyOperator(op: Operator, left: unknown, right: unknown): boolean {
  switch (op) {
    case "equals":
      return isEqual(left, right);
    case "notEquals":
      return !isEqual(left, right);
    case "contains":
      return toStr(left).toLowerCase().includes(toStr(right).toLowerCase());
    case "notContains":
      return !toStr(left).toLowerCase().includes(toStr(right).toLowerCase());
    case "greaterThan": {
      const c = compareOrdinal(left, right);
      return c === undefined ? false : c > 0;
    }
    case "greaterThanOrEquals": {
      const c = compareOrdinal(left, right);
      return c === undefined ? false : c >= 0;
    }
    case "lessThan": {
      const c = compareOrdinal(left, right);
      return c === undefined ? false : c < 0;
    }
    case "lessThanOrEquals": {
      const c = compareOrdinal(left, right);
      return c === undefined ? false : c <= 0;
    }
    default:
      return isEqual(left, right);
  }
}

function isEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  return toStr(left) === toStr(right);
}

// ---------------------------------------------------------------------------
// Rule evaluation (CNF)
// ---------------------------------------------------------------------------

export function evaluateRule(
  rule: { andGroups?: ConditionGroup[] } | ConditionalRule,
  ctx: EvalContext,
): RuleEvaluation {
  const andGroups = rule.andGroups ?? [];

  // Empty andGroups => not satisfied.
  if (andGroups.length === 0) {
    return { satisfied: false, groups: [] };
  }

  const groups: GroupResult[] = andGroups.map((group) => {
    const conditions = (group.conditions ?? []).map((c) => evaluateCondition(c, ctx));
    // Empty condition group => group not satisfied.
    const satisfied = conditions.length > 0 && conditions.some((r) => r.satisfied);
    return { satisfied, conditions };
  });

  const satisfied = groups.every((g) => g.satisfied);
  return { satisfied, groups };
}

// ---------------------------------------------------------------------------
// Property resolution: a rule REPLACES the static property value (design D15.5)
// ---------------------------------------------------------------------------

/**
 * Resolve a boolean property (visibility/required/disabled). When any rule
 * targets the property, the OR of those rules REPLACES the static value.
 * When no rule targets it, the static value stands.
 */
export function resolveProperty(
  staticValue: boolean,
  rules: ConditionalRule[] | undefined,
  targetProperty: ConditionalRule["targetProperty"],
  ctx: EvalContext,
): boolean {
  const relevant = (rules ?? []).filter((r) => r.targetProperty === targetProperty);
  if (relevant.length === 0) return staticValue;
  return relevant.some((r) => evaluateRule(r, ctx).satisfied);
}
