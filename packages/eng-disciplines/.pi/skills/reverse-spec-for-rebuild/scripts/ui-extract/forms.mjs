#!/usr/bin/env node
// Usage: node forms.mjs <effective.json> <adapter> <formKey> <formId> <outDir>
// Deterministic projection of one config-driven form:
//   <outDir>/<formId>.json  UI-model form (faithful: every setting kept, cites, views, flags)
//   <outDir>/<formId>.form  OpenForms FormSchemaJSON of the input view (gate: openforms diagnose)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { adapterOrExit } from "./lib.mjs";

const [effFile, adapterName, formKey, formId, outDir] = process.argv.slice(2);
if (!outDir) {
  console.error("usage: forms.mjs <effective.json> <adapter> <formKey> <formId> <outDir>");
  process.exit(2);
}
const adapter = await adapterOrExit(adapterName);
const eff = JSON.parse(readFileSync(effFile, "utf8"));
const form = eff.forms[formKey];
const views = adapter.formViews[formKey];

const conditionsOf = (s) =>
  (s.conditions ?? []).map((c, i) => {
    if (c.cond) return { index: i, kind: "validation", when: c.cond, message: c.msg ?? null, alsoCheck: c.alsoCheck ?? [] };
    if (c.init) return { index: i, kind: "init", bindings: c.init };
    return { index: i, kind: "unrecognized", raw: c }; // no cond/init: effect must be established from code
  });

const fields = form.fields.map(({ key, label, definedIn, settings: s }) => ({
  key,
  label,
  type: s.type ?? null,
  required: s.optional === false,
  editable: typeof s.editable === "object" ? { when: s.editable.cond } : s.editable ?? null,
  computed: !!s.computed,
  minLength: s.min_length ?? null,
  options: s.select_list ?? null,
  unit: s.unit ?? null,
  defaultValue: s.default_value ?? null,
  viewFormat: s.view_format ?? null,
  conditions: conditionsOf(s),
  views: views.filter((v) => v.show(s)).map((v) => v.id),
  flags: [
    ...(s.type ? [] : ["no-type"]),
    ...conditionsOf(s).filter((c) => c.kind === "unrecognized").map((c) => `unrecognized-condition[${c.index}]`),
  ],
  definedIn,
  settings: s,
}));

const model = {
  id: formId,
  formKey,
  variant: eff.variant,
  layers: eff.layers,
  merge: form.merge,
  render: form.render,
  labels: form.labels,
  views: views.map(({ id, cite }) => ({ id, cite })),
  fields,
};

// OpenForms projection of the input view. Expressions the schema cannot express
// (runtime option lists, JS validation conditions, conditional editability) are not translated:
// they stay in the UI model and the rule catalog; helpText points at them.
const ofField = (f) => {
  const type = adapter.typeMap[f.type] ?? "text";
  const help = [
    f.options && "Options: computed at runtime (see UI model)",
    f.unit && `Unit category: ${f.unit.category}`,
    f.conditions.some((c) => c.kind === "validation") && `${f.conditions.filter((c) => c.kind === "validation").length} validation rule(s), see UI model`,
    f.editable?.when && "Editable only under a runtime condition",
  ].filter(Boolean);
  return {
    key: f.key,
    type,
    label: f.label.hu ?? f.key,
    ...(f.required && { required: true }),
    ...(f.editable === false && { disabled: true }),
    ...(type === "text" && f.minLength && { validationRegex: `^.{${f.minLength},}$`, errorMessage: `min. ${f.minLength}` }),
    ...(type === "dropdown" && { options: [] }),
    ...(help.length && { helpText: help.join(" · ") }),
  };
};
const inputs = fields.filter((f) => f.views.includes("input"));
const openForm = {
  formTitle: `${formId} (${eff.variant})`,
  formDescription: `Projected from ${form.merge}; source of truth: ${formId}.json`,
  pages: [{ pageId: "p1", sections: [{ sectionId: "s1", rows: inputs.map((f) => ({ columns: [{ width: 12, fields: [ofField(f)] }] })) }] }],
  translations: { en: Object.fromEntries(inputs.filter((f) => f.label.gb).map((f) => [f.key, f.label.gb])) },
};

writeFileSync(join(outDir, `${formId}.json`), `${JSON.stringify(model, null, 1)}\n`);
writeFileSync(join(outDir, `${formId}.form`), `${JSON.stringify(openForm, null, 1)}\n`);
console.log(JSON.stringify({ fields: fields.length, input: inputs.map((f) => f.key), flags: fields.filter((f) => f.flags.length).map((f) => `${f.key}:${f.flags}`) }));
