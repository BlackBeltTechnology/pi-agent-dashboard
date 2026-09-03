/**
 * Authoring-time schema diagnostics.
 *
 * Returns a machine-readable list of findings, each carrying a severity, a
 * stable code, a human message, and a path locating the offending node.
 * `diagnose` operates on a normalized schema (call `normalizeSchema` first) but
 * tolerates a raw one.
 */
import type { Condition, ConditionalRule, Diagnostic, FormSchemaJSON } from "./types.js";
import { collectFieldKeys, walkFields } from "./walk.js";
import { isRecognisedOperator } from "../logic/operators.js";
import { checkFormulaParses } from "../logic/formula.js";

function eachCondition(
  rules: ConditionalRule[] | undefined,
  fn: (c: Condition, groupEmpty: boolean, andGroupsEmpty: boolean, rule: ConditionalRule) => void,
): void {
  for (const rule of rules ?? []) {
    if (!rule.andGroups || rule.andGroups.length === 0) {
      fn({ dependentFieldKey: "", operator: "equals" }, false, true, rule);
      continue;
    }
    for (const group of rule.andGroups) {
      if (!group.conditions || group.conditions.length === 0) {
        fn({ dependentFieldKey: "", operator: "equals" }, true, false, rule);
        continue;
      }
      for (const c of group.conditions) fn(c, false, false, rule);
    }
  }
}

/** Produce all findings for a schema. */
export function diagnose(schema: FormSchemaJSON): Diagnostic[] {
  const findings: Diagnostic[] = [];
  const knownKeys = new Set(collectFieldKeys(schema));
  const keyTypes = new Map<string, string>();
  walkFields(schema, ({ field }) => {
    if (field.type !== "header" && field.type !== "paragraph") keyTypes.set(field.key, field.type);
  });

  // ---- duplicate field keys ------------------------------------------------
  const keyPaths = new Map<string, string[]>();
  walkFields(schema, ({ field, path }) => {
    if (field.type === "header" || field.type === "paragraph") return;
    const arr = keyPaths.get(field.key) ?? [];
    arr.push(path);
    keyPaths.set(field.key, arr);
  });
  for (const [key, paths] of keyPaths) {
    if (paths.length > 1) {
      findings.push({
        severity: "error",
        code: "duplicate-key",
        message: `Duplicate field key "${key}" declared at ${paths.length} locations: ${paths.join(", ")}.`,
        path: paths[0],
      });
    }
  }

  // ---- per-field structural + rule diagnostics -----------------------------
  walkFields(schema, ({ field, path, repeaterDepth }) => {
    // repeater / matrix nested inside a repeater
    if (repeaterDepth >= 1 && field.type === "repeater") {
      findings.push({
        severity: "error",
        code: "repeater-in-repeater",
        message: `Repeater "${field.key}" is nested inside another repeater, which is unsupported.`,
        path,
      });
    }
    if (repeaterDepth >= 1 && field.type === "matrix") {
      findings.push({
        severity: "error",
        code: "matrix-in-repeater",
        message: `Matrix "${field.key}" is nested inside a repeater, which is unsupported.`,
        path,
      });
    }

    // conditionalRules on a field nested inside a repeater are inert upstream
    if (repeaterDepth >= 1 && field.conditionalRules && field.conditionalRules.length > 0) {
      findings.push({
        severity: "warning",
        code: "inert-repeater-child-rule",
        message: `Field "${field.key}" declares conditionalRules inside a repeater; the upstream renderer evaluates rule state for the repeater itself but not its child fields, so the rule has no effect.`,
        path,
      });
    }

    // optionsType: "api"
    if (
      (field.type === "dropdown" || field.type === "radio" || field.type === "checkbox") &&
      field.optionsType === "api"
    ) {
      findings.push({
        severity: "warning",
        code: "options-api-unsupported",
        message: `Field "${field.key}" uses optionsType "api"; remote option loading is not supported, so it renders disabled with an empty option list.`,
        path,
      });
    }

    // number-only flags
    if (field.type === "number") {
      if (field.isVisibleOnForm === false && !field.isCalculated) {
        findings.push({
          severity: "warning",
          code: "isvisibleonform-without-calculated",
          message: `Field "${field.key}" sets isVisibleOnForm:false without isCalculated:true; the flag is inert and the field renders normally.`,
          path,
        });
      }
      if (field.isCalculated && field.formulaExpression) {
        const err = checkFormulaParses(field.formulaExpression);
        if (err) {
          findings.push({
            severity: "warning",
            code: "unparseable-formula",
            message: `Field "${field.key}" has an unparseable formulaExpression (${err}); it will evaluate to 0.`,
            path,
          });
        }
      }
    }

    // rule conditions
    eachCondition(field.conditionalRules, (c, groupEmpty, andGroupsEmpty, rule) =>
      diagnoseCondition(findings, path, field.key, knownKeys, keyTypes, c, groupEmpty, andGroupsEmpty, rule.targetProperty),
    );
  });

  // ---- section rules -------------------------------------------------------
  schema.pages.forEach((page, pi) => {
    page.sections.forEach((section, si) => {
      const spath = `pages[${pi}].sections[${si}]`;
      eachCondition(section.conditionalRules, (c, groupEmpty, andGroupsEmpty, rule) =>
        diagnoseCondition(findings, spath, section.sectionId ?? spath, knownKeys, keyTypes, c, groupEmpty, andGroupsEmpty, rule.targetProperty),
      );
    });
  });

  // ---- cross-field rules ---------------------------------------------------
  (schema.crossFieldRules ?? []).forEach((rule, ri) => {
    const rpath = `crossFieldRules[${ri}]`;
    if (rule.andGroups) {
      if (rule.andGroups.length === 0 && !rule.expression) {
        findings.push({
          severity: "warning",
          code: "empty-and-groups",
          message: `Cross-field rule "${rule.id ?? ri}" declares andGroups:[]; it can never be satisfied and never blocks.`,
          path: rpath,
        });
      }
      rule.andGroups.forEach((group, gi) => {
        if (!group.conditions || group.conditions.length === 0) {
          findings.push({
            severity: "warning",
            code: "empty-condition-group",
            message: `Cross-field rule "${rule.id ?? ri}" group ${gi} has no conditions; the rule can never be satisfied.`,
            path: `${rpath}.andGroups[${gi}]`,
          });
        }
        (group.conditions ?? []).forEach((c) =>
          diagnoseCondition(findings, rpath, rule.id ?? String(ri), knownKeys, keyTypes, c, false, false, undefined),
        );
      });
    }
    // dangling targetFields
    for (const t of rule.targetFields ?? []) {
      if (!knownKeys.has(t)) {
        findings.push({
          severity: "error",
          code: "dangling-target-field",
          message: `Cross-field rule "${rule.id ?? ri}" targets "${t}", which no field defines.`,
          path: rpath,
        });
      }
    }
  });

  return findings;
}

function diagnoseCondition(
  findings: Diagnostic[],
  path: string,
  ownerKey: string,
  knownKeys: Set<string>,
  keyTypes: Map<string, string>,
  c: Condition,
  groupEmpty: boolean,
  andGroupsEmpty: boolean,
  targetProperty: string | undefined,
): void {
  if (andGroupsEmpty) {
    findings.push({
      severity: "warning",
      code: "empty-and-groups",
      message:
        `Rule on "${ownerKey}" declares andGroups:[]; it can never be satisfied.` +
        (targetProperty === "visibility" ? " Its visibility target is therefore always hidden." : ""),
      path,
    });
    return;
  }
  if (groupEmpty) {
    findings.push({
      severity: "warning",
      code: "empty-condition-group",
      message: `Rule on "${ownerKey}" has a condition group with no conditions; the rule can never be satisfied.`,
      path,
    });
    return;
  }

  // unrecognised operator
  if (typeof c.operator === "string" && !isRecognisedOperator(c.operator)) {
    findings.push({
      severity: "warning",
      code: "unrecognised-operator",
      message: `Rule on "${ownerKey}" uses unrecognised operator "${c.operator}"; it will be evaluated as equality.`,
      path,
    });
  }

  // contains/notContains on a checkbox
  if (c.operator === "contains" || c.operator === "notContains") {
    if (keyTypes.get(c.dependentFieldKey) === "checkbox") {
      findings.push({
        severity: "warning",
        code: "contains-on-checkbox",
        message: `Rule on "${ownerKey}" applies "${c.operator}" to checkbox "${c.dependentFieldKey}"; it operates on the joined string, not array membership.`,
        path,
      });
    }
  }

  // dangling dependent/compare references
  if (c.dependentFieldKey && !knownKeys.has(c.dependentFieldKey)) {
    findings.push({
      severity: "error",
      code: "dangling-dependent-field",
      message: `Rule on "${ownerKey}" references dependentFieldKey "${c.dependentFieldKey}", which no field defines.`,
      path,
    });
  }
  if (c.compareMode === "field" && c.compareToFieldKey && !knownKeys.has(c.compareToFieldKey)) {
    findings.push({
      severity: "error",
      code: "dangling-compare-field",
      message: `Rule on "${ownerKey}" references compareToFieldKey "${c.compareToFieldKey}", which no field defines.`,
      path,
    });
  }
}
