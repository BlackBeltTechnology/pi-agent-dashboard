// Ingestion boundary (§4.11–4.14): an existing .bpmn is source-of-truth. Its
// identifiers are OPAQUE — never re-derived, re-slugged or normalised — and the
// authoring naming rules become warnings, not refusals. Regenerating an existing
// file from prose is refused.

import { collectSemantics } from './guard.mjs';
import { deriveIdentifiers } from './identifiers.mjs';
import { BINDABLE } from './envelope.mjs';

/**
 * Extract authored elements from a parsed Definitions as
 * [{ key, id, type, name }], type stripped of the bpmn: prefix and lower-cased
 * to match the PREFIX table keys. key === id (the on-disk identifier).
 */
export function extractElements(rootElement) {
  const { flowNodes } = collectSemantics(rootElement);
  const out = [];
  // names live on the semantic element; re-walk to fetch them.
  const nameById = new Map();
  for (const r of rootElement.rootElements || []) {
    walkNames(r, nameById);
  }
  for (const [id, info] of flowNodes) {
    const type = info.type.replace('bpmn:', '');
    const t = type.charAt(0).toLowerCase() + type.slice(1);
    out.push({ key: id, id, type: t, name: nameById.get(id) || null });
  }
  return out;
}
function walkNames(node, map) {
  for (const fe of node.flowElements || []) {
    if (fe.name != null) map.set(fe.id, fe.name);
    if (fe.flowElements) walkNames(fe, map);
  }
}

/**
 * 4.11 — identifier opacity. Returns the file's identifiers unchanged. This is
 * the whole implementation: ingested ids are used as-is, never passed through
 * deriveIdentifiers.
 */
export function existingIdentifiers(rootElement) {
  return extractElements(rootElement).map((e) => e.id);
}

/**
 * 4.12 — naming rules produce WARNINGS on an existing file, never a refusal.
 * Runs the same duplicate-name / unnamed-bindable checks the authoring path
 * uses, but downgrades every diagnostic to a warning.
 */
export function ingestionWarnings(rootElement) {
  const els = extractElements(rootElement);
  const warnings = [];
  // duplicate names / duplicate ids — reuse the authoring logic, downgrade.
  const { diagnostics } = deriveIdentifiers(
    // deriveIdentifiers would derive slug ids; here we only want its rule
    // detection, so feed the real names but ignore the returned ids.
    els.map((e) => ({ key: e.id, type: e.type, name: e.name }))
  );
  for (const d of diagnostics) {
    warnings.push(`${d.code} (ingested, not enforced): ${d.message}`);
  }
  return { warnings };
}

/**
 * 4.13 — refuse to regenerate an existing .bpmn from prose. Lists the manifest
 * bindings and roles that reference the file, which regeneration would
 * invalidate. `manifest` is the parsed package.yaml object; `relPath` is the
 * file's path relative to the package root (matched against binding.in / entry).
 */
export function refuseRegeneration(relPath, manifest, entry) {
  const invalidated = [];
  const target = relPath;
  const ownerOf = (b) => (b.in || entry);
  for (const b of manifest?.bindings || []) {
    if (b.kind === 'participant') { if (b.ref === target) invalidated.push(`participant binding '${b.name || b.ref}'`); continue; }
    if (b.kind === 'process' && b.ref === target) invalidated.push(`process binding on ${b.element} → ${b.ref}`);
    if (ownerOf(b) === target) invalidated.push(`${b.kind} binding on ${b.element} (in ${ownerOf(b)})`);
  }
  for (const r of manifest?.roles || []) {
    if ((r.in || entry) === target) invalidated.push(`role '${r.role}' on ${r.element} (in ${r.in || entry})`);
  }
  return {
    refuse: true,
    reason: `${relPath} already exists and is the source of truth; edit it in place rather than regenerating from prose`,
    invalidatedBindings: invalidated,
  };
}

/** True if every id in `before` is still present (unchanged) in `after`. */
export function identifiersPreserved(beforeIds, afterIds) {
  const after = new Set(afterIds);
  return beforeIds.every((id) => after.has(id));
}
