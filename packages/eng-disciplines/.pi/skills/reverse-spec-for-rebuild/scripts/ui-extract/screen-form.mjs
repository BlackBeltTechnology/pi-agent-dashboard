#!/usr/bin/env node
// Usage: node screen-form.mjs <pkgDir> <screenId>
// Deterministic OpenForms projection of a screen's template-defined fields[] -> <pkgDir>/ui/forms/<screenId>.form
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [pkgDir, id] = process.argv.slice(2);
if (!id) {
  console.error("usage: screen-form.mjs <pkgDir> <screenId>");
  process.exit(2);
}
const s = JSON.parse(readFileSync(join(pkgDir, "ui", "screens", `${id}.json`), "utf8"));
const TYPE = { text: "text", textarea: "textarea", date: "date", number: "number", checkbox: "boolean", select: "dropdown" };
const field = (f) => ({
  key: f.key,
  type: TYPE[f.type] ?? "text",
  label: f.label ?? f.key,
  ...(f.required && { required: true }),
  ...(TYPE[f.type] === "dropdown" && { options: [] }),
  helpText: [f.default && `Default: ${f.default}`, `Binding: ${f.binding}`].filter(Boolean).join(" · "),
});
const form = {
  formTitle: `${s.name} (${id})`,
  formDescription: `Projected from ${s.template}; source of truth: ui/screens/${id}.json`,
  pages: [{ pageId: "p1", sections: [{ sectionId: "s1", rows: (s.fields ?? []).map((f) => ({ columns: [{ width: 12, fields: [field(f)] }] })) }] }],
};
writeFileSync(join(pkgDir, "ui", "forms", `${id}.form`), `${JSON.stringify(form, null, 1)}\n`);
console.log(JSON.stringify({ form: `ui/forms/${id}.form`, fields: (s.fields ?? []).map((f) => `${f.key}:${f.type}`) }));
