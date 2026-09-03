/**
 * TypeScript contract for the OpenForms `FormSchemaJSON`.
 *
 * The 14 field types are modelled as a discriminated union on `type`, so that a
 * type-specific property (e.g. `matrixRows`, `formulaExpression`) is only
 * reachable on the field types that declare it. Re-implemented from the upstream
 * `SCHEMA_REFERENCE.md`; no upstream source is copied.
 */

// ---------------------------------------------------------------------------
// Logic primitives (shared by conditionalRules and crossFieldRules)
// ---------------------------------------------------------------------------

export type Operator =
  | "equals"
  | "notEquals"
  | "contains"
  | "notContains"
  | "greaterThan"
  | "greaterThanOrEquals"
  | "lessThan"
  | "lessThanOrEquals"
  // Undocumented but genuine upstream aliases:
  | "gte"
  | "lte";

export type CompareMode = "value" | "field";

/** A single condition inspecting one field's answer. */
export interface Condition {
  dependentFieldKey: string;
  operator: Operator | string; // string tolerated: unknown operators fall back to `equals`.
  compareMode?: CompareMode;
  /** Static operand, used when compareMode is `"value"` or absent. */
  equalsValue?: unknown;
  /** Field whose live answer is the operand, used when compareMode is `"field"`. */
  compareToFieldKey?: string;
}

/** A CNF group: OR within, satisfied when at least one condition is satisfied. */
export interface ConditionGroup {
  conditions: Condition[];
}

export type TargetProperty = "visibility" | "required" | "disabled";

/** Field/section conditional rule. AND between groups, OR within a group. */
export interface ConditionalRule {
  targetProperty: TargetProperty;
  andGroups: ConditionGroup[];
}

/** Root-level cross-field rule; a satisfied rule is a *violation* that blocks. */
export interface CrossFieldRule {
  id?: string;
  andGroups?: ConditionGroup[];
  /** Legacy free-text form, retained for evaluation and flagged by diagnostics. */
  expression?: string;
  targetFields: string[];
  errorMessage: string;
}

/** Legacy visibility form migrated by `normalizeSchema`. */
export interface LegacyVisibilityCondition {
  dependentFieldKey: string;
  operator: Operator | string;
  compareMode?: CompareMode;
  equalsValue?: unknown;
  compareToFieldKey?: string;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface FieldOption {
  value: string;
  label: string;
}

export type OptionsType = "static" | "api";

// ---------------------------------------------------------------------------
// Field base + per-type fields (discriminated union on `type`)
// ---------------------------------------------------------------------------

export interface FieldBase {
  id?: string;
  key: string;
  label?: string;
  placeholder?: string;
  helpText?: string;
  required?: boolean;
  disabled?: boolean;
  conditionalRules?: ConditionalRule[];
  /** Legacy alternative to conditionalRules; migrated on normalization. */
  visibilityCondition?: LegacyVisibilityCondition;
}

export interface HeaderField extends FieldBase {
  type: "header";
}
export interface ParagraphField extends FieldBase {
  type: "paragraph";
}
export interface TextField extends FieldBase {
  type: "text";
  mask?: string;
  validationRegex?: string;
  errorMessage?: string;
  maxLength?: number;
}
export interface TextareaField extends FieldBase {
  type: "textarea";
  validationRegex?: string;
  errorMessage?: string;
  maxLength?: number;
  rows?: number;
}
export interface NumberField extends FieldBase {
  type: "number";
  min?: number;
  max?: number;
  /** Calculated fields derive their value and accept no direct input. */
  isCalculated?: boolean;
  formulaExpression?: string;
  /** Meaningful only alongside `isCalculated: true`. */
  isVisibleOnForm?: boolean;
}
export interface DateField extends FieldBase {
  type: "date";
  min?: string;
  max?: string;
}
export interface BooleanField extends FieldBase {
  type: "boolean";
}
export interface DropdownField extends FieldBase {
  type: "dropdown";
  options?: FieldOption[];
  optionsType?: OptionsType;
  optionsUrl?: string;
}
export interface RadioField extends FieldBase {
  type: "radio";
  options?: FieldOption[];
  optionsType?: OptionsType;
  optionsUrl?: string;
}
export interface CheckboxField extends FieldBase {
  type: "checkbox";
  options?: FieldOption[];
  optionsType?: OptionsType;
  optionsUrl?: string;
}
export interface MatrixField extends FieldBase {
  type: "matrix";
  matrixRows?: FieldOption[];
  matrixColumns?: FieldOption[];
}
export interface RepeaterField extends FieldBase {
  type: "repeater";
  /** Nested layout; its own rows/columns/fields. */
  rows?: Row[];
  minItems?: number;
  maxItems?: number;
  addLabel?: string;
  removeLabel?: string;
}
export interface SignatureField extends FieldBase {
  type: "signature";
}
export interface FileField extends FieldBase {
  type: "file";
  acceptedTypes?: string[];
  maxFileSizeMB?: number;
}

export type Field =
  | HeaderField
  | ParagraphField
  | TextField
  | TextareaField
  | NumberField
  | DateField
  | BooleanField
  | DropdownField
  | RadioField
  | CheckboxField
  | MatrixField
  | RepeaterField
  | SignatureField
  | FileField;

export type FieldType = Field["type"];

/** Field types that never contribute an answer entry. */
export const STATIC_FIELD_TYPES = ["header", "paragraph"] as const;

/** Field types that carry a selectable option list. */
export const OPTION_FIELD_TYPES = ["dropdown", "radio", "checkbox"] as const;

// ---------------------------------------------------------------------------
// Layout hierarchy
// ---------------------------------------------------------------------------

export interface Column {
  columnId?: string;
  /** Span out of 12 at the `md` breakpoint and above. */
  width?: number;
  fields: Field[];
}

export interface Row {
  rowId?: string;
  columns: Column[];
}

export interface Section {
  sectionId?: string;
  title?: string;
  description?: string;
  rows: Row[];
  conditionalRules?: ConditionalRule[];
  visibilityCondition?: LegacyVisibilityCondition;
}

export interface Page {
  pageId?: string;
  title?: string;
  description?: string;
  sections: Section[];
}

export interface FormSchemaJSON {
  formTitle?: string;
  formDescription?: string;
  pages: Page[];
  crossFieldRules?: CrossFieldRule[];
  translations?: TranslationsDictionary;
}

/** locale -> (translation key -> text). */
export type TranslationsDictionary = Record<string, Record<string, string>>;

// ---------------------------------------------------------------------------
// Answer-shape types (task 2.2)
// ---------------------------------------------------------------------------

export type MatrixAnswer = { [rowKey: string]: string };
export type RepeaterAnswer = Array<{ [childKey: string]: AnswerValue }>;
export interface FileAnswer {
  name: string;
  size: number;
  type: string;
  /** base64 data URL. */
  content: string;
}

export type AnswerValue =
  | string
  | number
  | boolean
  | string[]
  | MatrixAnswer
  | RepeaterAnswer
  | FileAnswer
  | null;

/** Maps a field type to the shape of its submitted value. */
export type AnswerOf<F extends Field> = F extends { type: "text" | "textarea" | "date" | "signature" }
  ? string
  : F extends { type: "number" }
    ? number | null
    : F extends { type: "boolean" }
      ? boolean
      : F extends { type: "dropdown" | "radio" }
        ? string
        : F extends { type: "checkbox" }
          ? string[]
          : F extends { type: "matrix" }
            ? MatrixAnswer
            : F extends { type: "repeater" }
              ? RepeaterAnswer
              : F extends { type: "file" }
                ? FileAnswer | null
                : never;

/** A loosely-typed answers object keyed by field `key`. */
export type FormAnswers = Record<string, AnswerValue>;

/** Diagnostic finding shape shared by `normalizeSchema` and `diagnose`. */
export type Severity = "error" | "warning" | "info";
export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  path: string;
}
