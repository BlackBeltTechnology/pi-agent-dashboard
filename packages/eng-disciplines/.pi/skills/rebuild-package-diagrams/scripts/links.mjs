// Use-case UI links: BPMN step -> UI action, each with evidence (a ref shared by the use case and
// the action, or a cite inside the action's handler/effect cites). Records: diagrams/uc-links/<UC>.json
// {useCase, links: [{action: "<SCR>#<ACT>", step, evidence: {refs} | {cite}}], noUi: reason|null}.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ITEM_RE = /\b(?:BR|QUIRK|GAP)-\d+\b/g;
const STEP_KIND = /(?:Task|task|Event|subProcess|callActivity)$/;

/** Flow nodes a UI action can realise: tasks, events, sub-processes, call activities (not gateways). */
export function bpmnSteps(xml) {
  const steps = new Map();
  for (const m of String(xml ?? "").matchAll(/<bpmn:(\w+)\b([^>]*)>/g)) {
    if (!STEP_KIND.test(m[1])) continue;
    const id = /\bid="([^"]+)"/.exec(m[2])?.[1];
    if (id && !steps.has(id)) steps.set(id, { id, name: /\bname="([^"]*)"/.exec(m[2])?.[1] ?? "", kind: m[1] });
  }
  return [...steps.values()];
}

const flowXml = (uc) => [uc.bpmnXml, ...(uc.altFlows ?? []).map((f) => f.bpmnXml)].filter(Boolean).join("\n");
const ucRefs = (uc) => new Set([...(uc.refs ?? []), ...(uc.requirements ?? []), ...(flowXml(uc).match(ITEM_RE) ?? [])]);
const actionRefs = (a) => new Set([...(a.guards ?? []), ...(a.refs ?? []), ...(a.effects ?? []).flatMap((e) => e.refs ?? [])]);

/** "SCR#ACT" -> {screen, action} over the UI model. */
function actionIndex(ui) {
  const idx = new Map();
  for (const s of ui.screens) for (const a of s.actions ?? []) idx.set(`${s.id}#${a.id}`, { screen: s, action: a });
  return idx;
}

/** Use cases with their flows' XML (main + alternate), as the catalog sees them. */
export function useCasesWithXml(pkgDir) {
  const diag = join(pkgDir, "diagrams");
  const read = (rel) => (rel && existsSync(join(diag, rel)) ? readFileSync(join(diag, rel), "utf8") : null);
  const ucs = existsSync(join(diag, "use-cases.json")) ? JSON.parse(readFileSync(join(diag, "use-cases.json"), "utf8")) : [];
  return ucs.map((uc) => ({ ...uc, bpmnXml: read(uc.bpmn), altFlows: (uc.altFlows ?? []).map((f) => ({ ...f, bpmnXml: read(f.bpmn) })) }));
}

/** Draft for one use case: its steps and the UI actions sharing refs with it (most shared first). */
export function linkDraft(ui, useCases, ucId) {
  const uc = useCases.find((u) => u.id === ucId);
  if (!uc) throw new Error(`unknown use case ${ucId}`);
  const refs = ucRefs(uc);
  const candidates = [...actionIndex(ui)]
    .map(([key, { action }]) => ({ action: key, label: action.label ?? "", shared: [...actionRefs(action)].filter((r) => refs.has(r)).sort() }))
    .filter((c) => c.shared.length)
    .sort((a, b) => b.shared.length - a.shared.length || a.action.localeCompare(b.action));
  return { useCase: uc.id, name: uc.name, refs: [...refs].sort(), steps: bpmnSteps(flowXml(uc)), candidates };
}

/** Records under diagrams/uc-links, or null without the directory. */
export function readLinks(pkgDir) {
  const dir = join(pkgDir, "diagrams", "uc-links");
  if (!existsSync(dir)) return null;
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ file: f, ...JSON.parse(readFileSync(join(dir, f), "utf8")) }));
}

const parseRange = (c) => {
  const m = /^(.+?):(\d+)(?:-(\d+))?$/.exec(String(c).trim());
  return m && { file: m[1], from: +m[2], to: +(m[3] ?? m[2]) };
};
/** Is `cite` (file:line) inside one of the action's handler/effect cites? */
function citeInside(action, cite) {
  const c = parseRange(cite);
  const ranges = [action.handler?.cite, ...(action.effects ?? []).map((e) => e.cite)].filter(Boolean).flatMap((x) => String(x).split(/;\s*/)).map(parseRange).filter(Boolean);
  return !!c && ranges.some((r) => r.file === c.file && c.from >= r.from && c.to <= r.to);
}

function evidenceErrors(uc, l, action) {
  const ev = l.evidence ?? {};
  const where = `${uc.id}: ${l.action}`;
  if (ev.refs?.length) {
    const shared = ucRefs(uc);
    const own = actionRefs(action);
    return ev.refs.filter((r) => !shared.has(r) || !own.has(r)).map((r) => `${where}: ref ${r} not shared by the use case and the action`);
  }
  if (ev.cite) return citeInside(action, ev.cite) ? [] : [`${where}: cite ${ev.cite} is outside the action's handler/effect cites`];
  return [`${where}: evidence needs refs or a cite`];
}

function recordErrors(rec, uc, idx) {
  const errors = [];
  const links = rec.links ?? [];
  if (!links.length && !String(rec.noUi ?? "").trim()) errors.push(`${uc.id}: no links and no noUi reason`);
  if (links.length && rec.noUi) errors.push(`${uc.id}: links and noUi together`);
  const steps = new Set(bpmnSteps(flowXml(uc)).map((s) => s.id));
  const seen = new Set();
  for (const l of links) {
    const hit = idx.get(l.action);
    if (!hit) errors.push(`${uc.id}: unknown screen action ${l.action}`);
    if (!steps.has(l.step)) errors.push(`${uc.id}: step ${l.step} is not a BPMN task or event of ${uc.id}`);
    if (hit) errors.push(...evidenceErrors(uc, l, hit.action));
    const k = `${l.action} @ ${l.step}`;
    if (seen.has(k)) errors.push(`${uc.id}: duplicate link ${k}`);
    seen.add(k);
  }
  return errors;
}

/** Gate over link records; `complete`: every use case has a record. */
export function checkLinks(ui, useCases, records, { complete = false } = {}) {
  const idx = actionIndex(ui);
  const byId = new Map(useCases.map((u) => [u.id, u]));
  const errors = [];
  for (const rec of records) {
    const uc = byId.get(rec.useCase);
    if (!uc) errors.push(`${rec.file}: unknown use case ${rec.useCase}`);
    else errors.push(...recordErrors(rec, uc, idx));
  }
  if (complete) {
    const have = new Set(records.map((r) => r.useCase));
    for (const uc of useCases) if (!have.has(uc.id)) errors.push(`${uc.id}: no uc-links record`);
  }
  return errors;
}

/** Use case + its link record: screens and UI actions extended, `uiLinks` (with step names), `noUi`. */
export function mergeLinks(uc, rec) {
  if (!rec) return { ...uc, uiLinks: [] };
  const names = new Map(bpmnSteps(flowXml(uc)).map((s) => [s.id, s.name]));
  const links = rec.links ?? [];
  const uniq = (xs) => [...new Set(xs)];
  return {
    ...uc,
    screens: uniq([...(uc.screens ?? []), ...links.map((l) => l.action.split("#")[0])]),
    uiActions: uniq([...(uc.uiActions ?? []), ...links.map((l) => l.action)]),
    uiLinks: links.map((l) => ({ action: l.action, step: l.step, stepName: names.get(l.step) ?? "", evidence: l.evidence })),
    ...(rec.noUi ? { noUi: rec.noUi } : {}),
  };
}
