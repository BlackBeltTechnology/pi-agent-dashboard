/**
 * Whole-form logic state derived from a schema and the current answers.
 *
 * This is the single place that combines: calculated-field recomputation,
 * section visibility, and per-field visibility/required/disabled resolution
 * (a field is visible only when both its own rule state and its section are
 * visible). Repeater child fields are intentionally excluded — the upstream
 * renderer never evaluates rule state for them (see the inert-repeater-child
 * diagnostic).
 */
import type {
  AnswerValue,
  Diagnostic,
  FormAnswers,
  FormSchemaJSON,
  NumberField,
} from "../schema/types.js";
import { walkFields } from "../schema/walk.js";
import { evaluateFormula } from "./formula.js";
import { EvalContext, RuleEvaluation, evaluateRule, resolveProperty } from "./cnf.js";

export interface FieldLogicState {
  key: string;
  /** Effective visibility: own visibility rule AND containing section. */
  visible: boolean;
  required: boolean;
  disabled: boolean;
  /** True for a `number` field with `isCalculated: true`. */
  calculated: boolean;
  /** For a calculated field, whether `isVisibleOnForm` is false. */
  hiddenCalculated: boolean;
  type: string;
  sectionId: string;
}

export interface FormLogicState {
  /** Top-level fields only, keyed by field `key`. */
  fields: Map<string, FieldLogicState>;
  /** sectionId -> visible. */
  sections: Map<string, boolean>;
  /** Answers with calculated values filled in. */
  effectiveAnswers: FormAnswers;
  diagnostics: Diagnostic[];
}

/** Recompute calculated `number` fields to a fixed point. */
export function computeCalculatedValues(
  schema: FormSchemaJSON,
  answers: FormAnswers,
): { answers: FormAnswers; diagnostics: Diagnostic[] } {
  const out: FormAnswers = { ...answers };
  const diagnostics: Diagnostic[] = [];
  const calc: Array<{ field: NumberField; path: string }> = [];
  walkFields(schema, ({ field, path, repeaterDepth }) => {
    if (repeaterDepth === 0 && field.type === "number" && field.isCalculated && field.formulaExpression) {
      calc.push({ field, path });
    }
  });
  if (calc.length === 0) return { answers: out, diagnostics };

  const resolveRef = (key: string): number => {
    const v = out[key];
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  // Fixed-point: at most calc.length + 1 passes resolves any acyclic chain.
  const maxPasses = calc.length + 1;
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    for (const { field } of calc) {
      const result = evaluateFormula(field.formulaExpression!, resolveRef);
      if (out[field.key] !== result.value) {
        out[field.key] = result.value;
        changed = true;
      }
      if (pass === 0 && result.error) {
        diagnostics.push({
          severity: "warning",
          code: "unparseable-formula",
          message: `Calculated field "${field.key}" formula did not evaluate (${result.error}); using 0.`,
          path: field.key,
        });
      }
    }
    if (!changed) break;
  }
  return { answers: out, diagnostics };
}

/** Compute the full logic state for a schema and answers. */
export function resolveFormState(schema: FormSchemaJSON, answers: FormAnswers): FormLogicState {
  const { answers: effectiveAnswers, diagnostics } = computeCalculatedValues(schema, answers);

  const ctx: EvalContext = {
    getAnswer: (key: string): AnswerValue | undefined =>
      Object.prototype.hasOwnProperty.call(effectiveAnswers, key) ? effectiveAnswers[key] : undefined,
  };

  const sections = new Map<string, boolean>();
  schema.pages.forEach((page, pi) => {
    page.sections.forEach((section, si) => {
      const id = section.sectionId ?? `p${pi}-s${si}`;
      const visible = resolveProperty(true, section.conditionalRules, "visibility", ctx);
      sections.set(id, visible);
    });
  });

  const fields = new Map<string, FieldLogicState>();
  schema.pages.forEach((page, pi) => {
    page.sections.forEach((section, si) => {
      const sectionId = section.sectionId ?? `p${pi}-s${si}`;
      const sectionVisible = sections.get(sectionId) ?? true;
      section.rows.forEach((row) => {
        row.columns.forEach((col) => {
          col.fields.forEach((field) => {
            if (field.type === "header" || field.type === "paragraph") return;
            const ownVisible = resolveProperty(true, field.conditionalRules, "visibility", ctx);
            const calculated = field.type === "number" && !!field.isCalculated;
            const hiddenCalculated = calculated && (field as NumberField).isVisibleOnForm === false;
            fields.set(field.key, {
              key: field.key,
              type: field.type,
              sectionId,
              visible: ownVisible && sectionVisible,
              required: resolveProperty(!!field.required, field.conditionalRules, "required", ctx),
              // A calculated field is not user-editable; treat as disabled for input.
              disabled: calculated || resolveProperty(!!field.disabled, field.conditionalRules, "disabled", ctx),
              calculated,
              hiddenCalculated,
            });
          });
        });
      });
    });
  });

  return { fields, sections, effectiveAnswers, diagnostics };
}

/** Inspectable per-rule evaluation for the debug panel (task 3.13). */
export interface RuleExplanation {
  ownerKey: string;
  kind: "field-visibility" | "field-required" | "field-disabled" | "section-visibility" | "cross-field";
  targetProperty?: string;
  evaluation: RuleEvaluation;
}

export function explainRules(schema: FormSchemaJSON, answers: FormAnswers): RuleExplanation[] {
  const { answers: effectiveAnswers } = computeCalculatedValues(schema, answers);
  const ctx: EvalContext = {
    getAnswer: (key) =>
      Object.prototype.hasOwnProperty.call(effectiveAnswers, key) ? effectiveAnswers[key] : undefined,
  };
  const out: RuleExplanation[] = [];

  schema.pages.forEach((page, pi) => {
    page.sections.forEach((section, si) => {
      const sid = section.sectionId ?? `p${pi}-s${si}`;
      for (const rule of section.conditionalRules ?? []) {
        out.push({ ownerKey: sid, kind: "section-visibility", targetProperty: "visibility", evaluation: evaluateRule(rule, ctx) });
      }
    });
  });

  walkFields(schema, ({ field, repeaterDepth }) => {
    if (repeaterDepth !== 0) return;
    for (const rule of field.conditionalRules ?? []) {
      out.push({
        ownerKey: field.key,
        kind: `field-${rule.targetProperty}` as RuleExplanation["kind"],
        targetProperty: rule.targetProperty,
        evaluation: evaluateRule(rule, ctx),
      });
    }
  });

  (schema.crossFieldRules ?? []).forEach((rule) => {
    out.push({ ownerKey: rule.id ?? "cross", kind: "cross-field", evaluation: evaluateRule(rule, ctx) });
  });

  return out;
}
