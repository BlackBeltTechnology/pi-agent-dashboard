// Package manifest contract and validation (§5).
//
// package.yaml is the single source of the link graph. The .bpmn/.dmn/.form
// files stay vendor-neutral; all bindings and roles live here. Validation is a
// manifest-to-artifact JOIN, independent of any BPMN dialect.

import { readFileSync, existsSync, realpathSync, statSync } from 'node:fs';
import { join, resolve, isAbsolute, dirname } from 'node:path';
import { parseDocument, stringify } from '../assets/lib/yaml.mjs';
import { parse } from './pipeline.mjs';
import { writeFileSync } from 'node:fs';

const REQUIRED_TYPE = {
  decision: 'businessRuleTask',
  form: 'userTask',
  process: 'callActivity',
  participant: null, // file-scoped
};
const KINDS = Object.keys(REQUIRED_TYPE);

// ── manifest loading ────────────────────────────────────────────────────
/** Parse package.yaml with duplicate-key detection. Returns { manifest, errors }. */
export function loadManifest(pkgDir) {
  const p = join(pkgDir, 'package.yaml');
  if (!existsSync(p)) return { manifest: null, errors: [{ code: 'NO-MANIFEST', message: `no package.yaml in ${pkgDir}` }] };
  const doc = parseDocument(readFileSync(p, 'utf8'), { uniqueKeys: true });
  const errors = [];
  for (const e of doc.errors) {
    errors.push({ code: e.code === 'DUPLICATE_KEY' ? 'DUP-KEY' : 'YAML', message: e.message });
  }
  if (errors.length) return { manifest: null, errors };
  return { manifest: doc.toJS() || {}, errors: [] };
}

// ── path resolution + containment (5.5) ─────────────────────────────────
/** Resolve a manifest-relative path, enforcing containment after realpath. */
export function resolveContained(pkgDir, rel) {
  if (isAbsolute(rel)) return { error: `absolute path '${rel}' is not allowed; manifest paths are relative to the package root` };
  const target = resolve(pkgDir, rel);
  const rootReal = realpathSync(pkgDir);
  let real;
  try { real = existsSync(target) ? realpathSync(target) : target; }
  catch { real = target; }
  // physical containment: realpath(target) must sit within realpath(root)
  const within = real === rootReal || real.startsWith(rootReal + '/');
  if (!within) return { error: `path '${rel}' resolves outside the package root (after following symlinks)` };
  return { path: target, real };
}

// ── artifact structural checks (5.10) ───────────────────────────────────
export function checkDmn(text) {
  if (!/xmlns(:\w+)?="https?:\/\/www\.omg\.org\/spec\/DMN\//.test(text) && !/<(\w+:)?definitions[^>]*DMN/i.test(text)) {
    return { ok: false, reason: 'does not parse as DMN (no DMN namespace)' };
  }
  const decisions = (text.match(/<(\w+:)?decision\b/g) || []).length;
  const hasDrdDI = /<(\w+:)?DMNDI\b/.test(text) || /<dmndi:/.test(text);
  if (decisions > 1 && !hasDrdDI) {
    return { ok: false, reason: `declares ${decisions} decisions but carries no DRD DI; the decision-table view cannot render a multi-decision DRD without layout` };
  }
  return { ok: true, decisions, hasDrdDI };
}
export function checkForm(text) {
  let v;
  try { v = JSON.parse(text); } catch { return { ok: false, reason: 'is not valid JSON' }; }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return { ok: false, reason: 'is not a JSON object' };
  return { ok: true, structuralOnly: true };
}

// ── element resolution ──────────────────────────────────────────────────
async function elementsOf(pkgDir, relFile, cache) {
  if (cache.has(relFile)) return cache.get(relFile);
  const r = resolveContained(pkgDir, relFile);
  if (r.error || !existsSync(r.path)) { cache.set(relFile, null); return null; }
  const { rootElement } = await parse(readFileSync(r.path, 'utf8'));
  const map = new Map(); // id -> { type, name }
  for (const root of rootElement.rootElements || []) walk(root, map);
  cache.set(relFile, map);
  return map;
}
function walk(node, map) {
  for (const fe of node.flowElements || []) {
    const type = fe.$type.replace('bpmn:', '');
    map.set(fe.id, { type: type.charAt(0).toLowerCase() + type.slice(1), name: fe.name || null });
    if (fe.flowElements) walk(fe, map);
  }
}

// ── similarity for reconciliation (5.18) ────────────────────────────────
function deburrLower(s) {
  return (s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x00-\x7f]/g, '').toLowerCase();
}
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[m][n];
}
export function similarity(a, b) {
  const x = deburrLower(a), y = deburrLower(b);
  if (!x && !y) return 1;
  const max = Math.max(x.length, y.length) || 1;
  return 1 - levenshtein(x, y) / max;
}
export const SIMILARITY_THRESHOLD = 0.6;

/**
 * Reconcile a dangling entry against survivors of the required type.
 * Returns { kind: 'suggestion'|'ambiguous'|'none', candidates:[{id,name,score}] }.
 * Pure — never writes.
 */
export function reconcile(recordedName, requiredType, survivors) {
  const scored = survivors
    .filter((s) => !requiredType || s.type === requiredType)
    .map((s) => ({ id: s.id, name: s.name, score: similarity(recordedName, s.name) }))
    .filter((s) => s.score >= SIMILARITY_THRESHOLD)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return { kind: 'none', candidates: [] };
  const top = scored[0].score;
  const tied = scored.filter((s) => s.score === top);
  if (tied.length > 1) return { kind: 'ambiguous', candidates: tied };
  return { kind: 'suggestion', candidates: [scored[0]] };
}

/**
 * Persist refreshed recorded-names back to package.yaml (5.17a). This is the
 * ONLY permitted manifest write in a non-interactive context: it changes only
 * the `name` a still-resolving binding records, never re-points/drops/creates a
 * binding. Returns true if a write occurred.
 */
export function persistRefreshedNames(pkgDir, validation) {
  if (!validation.refreshes || !validation.refreshes.length || !validation.updatedManifest) return false;
  writeFileSync(join(pkgDir, 'package.yaml'), stringify(validation.updatedManifest));
  return true;
}

// ── full validation (5.1–5.20) ──────────────────────────────────────────
/**
 * Validate a package. Returns:
 *   { ok, errors, warnings, diagnostics, refreshes, updatedManifest, reconciliations }
 * `opts.interactive` (default false) gates reconciliation writes; the recorded-
 * name refresh happens regardless (5.17a exemption).
 * `opts.generatedFiles` — set of rel paths this run generated (vendor-attr rule).
 */
export async function validatePackage(pkgDir, opts = {}) {
  const interactive = !!opts.interactive;
  const generatedFiles = opts.generatedFiles || new Set();
  const errors = [], warnings = [], diagnostics = [], refreshes = [], reconciliations = [];
  const { manifest, errors: loadErr } = loadManifest(pkgDir);
  if (loadErr.length) return { ok: false, errors: loadErr, warnings, diagnostics, refreshes, updatedManifest: null, reconciliations };

  if (!manifest.name) errors.push({ code: 'NO-NAME', message: 'manifest is missing required `name`' });
  if (!manifest.entry) errors.push({ code: 'NO-ENTRY', message: 'manifest is missing required `entry`' });
  const entry = manifest.entry;
  const cache = new Map();

  // entry must resolve to an existing .bpmn
  if (entry) {
    const er = resolveContained(pkgDir, entry);
    if (er.error) errors.push({ code: 'ENTRY-PATH', message: er.error });
    else if (!existsSync(er.path)) errors.push({ code: 'ENTRY-MISSING', message: `entry '${entry}' does not exist` });
  }

  const bindings = manifest.bindings || [];
  const roles = manifest.roles || [];
  const updatedBindings = bindings.map((b) => ({ ...b }));
  const updatedRoles = roles.map((r) => ({ ...r }));

  // ── bindings ──
  for (let i = 0; i < bindings.length; i++) {
    const b = bindings[i];
    const label = `binding[${i}]`;
    if (!KINDS.includes(b.kind)) { errors.push({ code: 'BAD-KIND', message: `${label} kind '${b.kind}' is not one of: ${KINDS.join(', ')}` }); continue; }

    // 5.5 ref path
    if (!b.ref) { errors.push({ code: 'NO-REF', message: `${label} has no ref` }); continue; }
    const rr = resolveContained(pkgDir, b.ref);
    if (rr.error) { errors.push({ code: 'REF-PATH', message: `${label}: ${rr.error}` }); continue; }

    // 5.9 participant is file-scoped
    if (b.kind === 'participant') {
      if (b.element || b.in) errors.push({ code: 'PARTICIPANT-SCOPE', message: `${label} kind: participant is file-scoped; remove element/in` });
      if (!b.name) errors.push({ code: 'PARTICIPANT-NAME', message: `${label} kind: participant requires a name for the switcher label` });
      // duplicate of entry (viewer 7.15)
      if (entry && b.ref === entry) errors.push({ code: 'PARTICIPANT-DUP-ENTRY', message: `${label} references the entry file as a participant; the entry is already in the switcher` });
      // ref must parse as BPMN + exist
      if (!existsSync(rr.path)) errors.push({ code: 'REF-MISSING', message: `${label} ref '${b.ref}' does not exist` });
      else if (!/<(\w+:)?definitions/.test(readFileSync(rr.path, 'utf8'))) errors.push({ code: 'REF-CONTENT', message: `${label} ref '${b.ref}' does not parse as BPMN` });
      continue;
    }

    // element-scoped kinds
    if (!b.element) { errors.push({ code: 'NO-ELEMENT', message: `${label} kind: ${b.kind} requires an element` }); continue; }
    const owner = b.in || entry;

    // ref existence + kind-appropriate content (5.10)
    if (!existsSync(rr.path)) { errors.push({ code: 'REF-MISSING', message: `${label} ref '${b.ref}' does not resolve to an existing file` }); }
    else {
      const text = readFileSync(rr.path, 'utf8');
      if (b.kind === 'decision') {
        const c = checkDmn(text);
        if (!c.ok) errors.push({ code: 'REF-CONTENT', message: `${label} ref '${b.ref}' ${c.reason}` });
      } else if (b.kind === 'process') {
        if (!/<(\w+:)?definitions/.test(text)) errors.push({ code: 'REF-CONTENT', message: `${label} ref '${b.ref}' does not parse as BPMN` });
      } else if (b.kind === 'form') {
        const c = checkForm(text);
        if (!c.ok) errors.push({ code: 'REF-CONTENT', message: `${label} ref '${b.ref}' ${c.reason}` });
        else diagnostics.push({ code: 'FORM-STRUCTURAL-ONLY', message: `${label}: form '${b.ref}' validated for structural validity only; the OpenForms schema contract is unavailable, so schema conformance was not checked` });
      }
    }

    // element resolution + type match (5.8) + dangling (5.13) + reconciliation (5.18)
    const elems = await elementsOf(pkgDir, owner, cache);
    const required = REQUIRED_TYPE[b.kind];
    if (!elems) { errors.push({ code: 'OWNER-MISSING', message: `${label} in '${owner}' cannot be read` }); continue; }
    const el = elems.get(b.element);
    if (!el) {
      // dangling — try reconciliation on recorded name
      const survivors = [...elems].map(([id, m]) => ({ id, ...m }));
      const rec = reconcile(b.name || '', required, survivors);
      if (rec.kind === 'none') {
        errors.push({ code: 'DANGLING', message: `${label} element '${b.element}' absent from '${owner}' (ref → ${b.ref}); no plausible surviving ${required} matches the recorded name '${b.name || ''}'` });
      } else {
        reconciliations.push({ label, kind: rec.kind, recordedName: b.name || '', requiredType: required, candidates: rec.candidates, applied: false });
        errors.push({ code: 'DANGLING-RECONCILE', message: `${label} element '${b.element}' absent from '${owner}'; ${rec.kind === 'ambiguous' ? 'ambiguous match' : 'suggested'} ${rec.candidates.map((c) => `${c.id} ('${c.name}', ${c.score.toFixed(2)})`).join(', ')} — confirm before re-pointing` });
      }
      continue;
    }
    // type match
    if (required && el.type !== required) {
      errors.push({ code: 'TYPE-MISMATCH', message: `${label} kind: ${b.kind} requires a ${required} but '${b.element}' is a ${el.type}` });
    }
    // 4.5 — unnamed elements are not bindable
    if (!el.name) errors.push({ code: 'UNNAMED-TARGET', message: `${label} targets '${b.element}', which has no name; only named elements are bindable` });

    // 5.17 / 5.17a — record + refresh the target name
    if (el.name) {
      if (b.name !== el.name) { refreshes.push({ label, from: b.name || null, to: el.name }); updatedBindings[i].name = el.name; }
      // 5.19 stale-name report when id intact but recorded name differs
      if (b.name && b.name !== el.name) warnings.push({ code: 'STALE-NAME', message: `${label} recorded name '${b.name}' is stale; element '${b.element}' is now named '${el.name}' — refreshed` });
    }
  }

  // ── roles (5.12, 5.13, 5.17, 5.18a) ──
  const roleByElement = new Map(); // `${owner}\u0000${element}` -> role
  for (let i = 0; i < roles.length; i++) {
    const r = roles[i];
    const owner = r.in || entry;
    if (!r.element || !r.role) { errors.push({ code: 'ROLE-INCOMPLETE', message: `roles[${i}] requires element and role` }); continue; }
    const key = `${owner}\u0000${r.element}`;
    if (roleByElement.has(key)) errors.push({ code: 'ROLE-DOUBLE', message: `element '${r.element}' in '${owner}' is assigned two roles: '${roleByElement.get(key)}' and '${r.role}'` });
    else roleByElement.set(key, r.role);

    const elems = await elementsOf(pkgDir, owner, cache);
    if (!elems) { errors.push({ code: 'OWNER-MISSING', message: `roles[${i}] in '${owner}' cannot be read` }); continue; }
    const el = elems.get(r.element);
    if (!el) {
      const survivors = [...elems].map(([id, m]) => ({ id, ...m }));
      const rec = reconcile(r.name || '', null, survivors);
      if (rec.kind === 'none') errors.push({ code: 'ROLE-DANGLING', message: `roles[${i}] element '${r.element}' absent from '${owner}'` });
      else { reconciliations.push({ label: `roles[${i}]`, kind: rec.kind, recordedName: r.name || '', candidates: rec.candidates, applied: false }); errors.push({ code: 'ROLE-DANGLING-RECONCILE', message: `roles[${i}] element '${r.element}' absent; suggested ${rec.candidates.map((c) => `${c.id} ('${c.name}')`).join(', ')}` }); }
      continue;
    }
    if (el.name) {
      if (r.name !== el.name) { refreshes.push({ label: `roles[${i}]`, from: r.name || null, to: el.name }); updatedRoles[i].name = el.name; }
      if (r.name && r.name !== el.name) warnings.push({ code: 'STALE-NAME', message: `roles[${i}] recorded name '${r.name}' is stale; element is now '${el.name}' — refreshed` });
    }
  }

  // ── orphan + unbound reporting (5.14) ──
  await reportOrphansAndUnbound(pkgDir, manifest, entry, cache, warnings);

  // ── composition boundaries (5.15 nested pkg, 5.16 cycle) ──
  await checkComposition(pkgDir, manifest, entry, errors, warnings);

  // ── vendor-attribute handling (5.11) ──
  await checkVendorAttributes(pkgDir, manifest, entry, generatedFiles, errors, warnings, cache);

  const ok = errors.length === 0;
  return {
    ok, errors, warnings, diagnostics, refreshes, reconciliations,
    updatedManifest: { ...manifest, bindings: updatedBindings, roles: updatedRoles },
  };
}

async function reportOrphansAndUnbound(pkgDir, manifest, entry, cache, warnings) {
  const bindings = manifest.bindings || [];
  const referenced = new Set([entry, ...bindings.map((b) => b.ref)].filter(Boolean));
  // orphan artifact files
  const { readdirSync } = await import('node:fs');
  const walkDir = (dir, base = '') => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const rel = base ? `${base}/${f.name}` : f.name;
      if (f.isDirectory()) walkDir(join(dir, f.name), rel);
      else if (/\.(dmn|form|bpmn)$/.test(f.name)) {
        if (!referenced.has(rel) && rel !== entry) warnings.push({ code: 'ORPHAN', message: `artifact '${rel}' is referenced by no binding` });
      }
    }
  };
  try { walkDir(pkgDir); } catch { /* ignore */ }
  // unbound bindable elements in the entry
  const boundElems = new Set(bindings.filter((b) => b.element).map((b) => `${b.in || entry}\u0000${b.element}`));
  const elems = await elementsOf(pkgDir, entry, cache);
  if (elems) for (const [id, m] of elems) {
    if (['userTask', 'businessRuleTask', 'callActivity'].includes(m.type) && !boundElems.has(`${entry}\u0000${id}`)) {
      warnings.push({ code: 'UNBOUND', message: `${m.type} '${id}' in the entry process is covered by no binding` });
    }
  }
}

async function checkComposition(pkgDir, manifest, entry, errors, warnings) {
  const bindings = manifest.bindings || [];
  // 5.15 nested package: a package.yaml beside a referenced .bpmn
  for (const b of bindings) {
    if ((b.kind === 'process' || b.kind === 'participant') && b.ref) {
      const rr = resolveContained(pkgDir, b.ref);
      if (rr.path && existsSync(rr.path)) {
        const sibling = join(dirname(rr.path), 'package.yaml');
        if (existsSync(sibling) && dirname(rr.path) !== realpathSync(pkgDir)) {
          errors.push({ code: 'NESTED-PACKAGE', message: `ref '${b.ref}' sits beside its own package.yaml; nested packages are not supported in this change` });
        }
      }
    }
  }
  // 5.16 cycle detection as WARNING
  const graph = new Map(); // file -> [files]
  const fileFor = (b) => b.ref;
  const owners = new Set([entry]);
  for (const b of bindings) if (b.kind === 'process' || b.kind === 'participant') owners.add(b.in || entry);
  for (const b of bindings) {
    if (b.kind === 'process') {
      const from = b.in || entry, to = fileFor(b);
      if (!graph.has(from)) graph.set(from, []);
      graph.get(from).push(to);
    }
  }
  const cycle = findCycle(graph);
  if (cycle) warnings.push({ code: 'CYCLE', message: `binding graph has a cycle: ${cycle.join(' → ')}; recursion is legal BPMN and the package is still served (the viewer bounds navigation)` });
}
function findCycle(graph) {
  const visiting = new Set(), done = new Set();
  let found = null;
  const dfs = (n, stack) => {
    if (found) return;
    visiting.add(n); stack.push(n);
    for (const m of graph.get(n) || []) {
      if (visiting.has(m)) { found = [...stack, m]; return; }
      if (!done.has(m)) dfs(m, stack);
    }
    visiting.delete(n); done.add(n); stack.pop();
  };
  for (const n of graph.keys()) if (!done.has(n)) dfs(n, []);
  return found;
}

async function checkVendorAttributes(pkgDir, manifest, entry, generatedFiles, errors, warnings, cache) {
  const bindings = manifest.bindings || [];
  const files = new Set([entry, ...bindings.map((b) => b.ref).filter((r) => r && r.endsWith('.bpmn'))].filter(Boolean));
  const linkAttrRe = /\b(camunda|zeebe|activiti|flowable):(decisionRef|formKey|formDefinition|calledElement|calledDecisionId)\b/;
  for (const rel of files) {
    const rr = resolveContained(pkgDir, rel);
    if (!rr.path || !existsSync(rr.path)) continue;
    const text = readFileSync(rr.path, 'utf8');
    if (linkAttrRe.test(text)) {
      if (generatedFiles.has(rel)) {
        errors.push({ code: 'VENDOR-ATTR', message: `generated file '${rel}' carries a vendor link attribute duplicating a binding; link information belongs in package.yaml, not in a vendor extension` });
      } else {
        warnings.push({ code: 'VENDOR-ATTR-INGESTED', message: `ingested file '${rel}' carries a vendor link attribute; tolerated (link information is authoritative in the manifest)` });
      }
    }
  }
}
