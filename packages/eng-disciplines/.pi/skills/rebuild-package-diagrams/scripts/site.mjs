// build-site: assemble a rebuild package + its diagrams into one self-contained HTML catalog.
// See change: add-rebuild-package-diagrams, add-catalog-questions, add-catalog-ui-model.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { archViews, checkArch, readArch, toMermaidC4, toStructurizr } from "./arch.mjs";
import { behaviourData } from "./behaviour.mjs";
import { checkCrud, crudData, readCrud } from "./crud.mjs";
import { buildIfml, ifmlToXmi } from "./ifml.mjs";
import { CARD, checkQuestions, checkUi, checkUseCases, extractModel, parseCatalog, parseRoles, parseSpec, readIf, readUi, renderEr } from "./lib.mjs";
import { checkLinks, mergeLinks, readLinks } from "./links.mjs";
import { DEFAULT_BUDGET, erChunks, ifmlParts } from "./split.mjs";
import { checkUsage, readMapping } from "./usage.mjs";
import { checkVariability, readConfigInputs, readVariability, variabilityData } from "./variability.mjs";

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), "..", "templates");
const REF_RE = /\b(?:BR|QUIRK|GAP)-\d+\b/g;
const ident = (s) => s.replace(/[^A-Za-z0-9_]/g, "_");

function readCapabilities(pkgDir) {
  const capDir = join(pkgDir, "capabilities");
  const caps = {};
  if (!existsSync(capDir)) return caps;
  for (const cap of readdirSync(capDir).sort()) {
    const spec = join(capDir, cap, "spec.md");
    if (existsSync(spec)) caps[cap] = parseSpec(readFileSync(spec, "utf8"));
  }
  return caps;
}

function addEntityRows(entities, ent, modelEntity) {
  const rows = (entities[ent.name] ??= []);
  const types = new Map(modelEntity.fields.map((x) => [x.name, x.type]));
  for (const fld of ent.fields ?? []) {
    if (rows.some((r) => r.name === fld.name)) continue;
    const type = ident(fld.type ?? types.get(fld.name).split(/[\s(|<]/)[0]) || "any";
    rows.push({ name: fld.name, type, key: fld.key ?? "" });
  }
}

function addRelations(relations, list) {
  for (const r of list ?? []) {
    if (relations.some((x) => x.from === r.from && x.to === r.to && x.label === r.label)) continue;
    const conn = r.confidence === "confirmed" ? CARD[r.cardinality] : CARD[r.cardinality].replace("--", "..");
    relations.push({ ...r, conn });
  }
}

/** Union of all gated er/*.json files: per-entity attribute rows + deduplicated relations. */
function readEr(diagDir, model, errors) {
  const erDir = join(diagDir, "er");
  const byName = new Map(model.entities.map((e) => [e.name, e]));
  const entities = {};
  const relations = [];
  const clusters = [];
  const files = existsSync(erDir) ? readdirSync(erDir).filter((x) => x.endsWith(".json")).sort() : [];
  for (const f of files) {
    const er = JSON.parse(readFileSync(join(erDir, f), "utf8"));
    const gate = renderEr(er, model);
    if (gate.errors.length) {
      errors.push(...gate.errors.map((e) => `er/${f}: ${e}`));
      continue;
    }
    for (const ent of er.entities ?? []) addEntityRows(entities, ent, byName.get(ent.name));
    addRelations(relations, er.relations);
    if (f !== "overview.json") clusters.push({ name: f.replace(/\.json$/, ""), entities: (er.entities ?? []).map((e) => e.name), relations: (er.relations ?? []).length });
  }
  return { entities, relations, clusters };
}

function bpmnFor(diagDir, uc) {
  if (!uc.bpmn) return { bpmnXml: null, roles: [] };
  const file = join(diagDir, uc.bpmn);
  const xml = readIf(file);
  return { bpmnXml: xml || null, roles: parseRoles(readIf(join(dirname(file), "package.yaml"))) };
}

/** Alternate flows of a use case (e.g. derived from code): [{label, bpmn, bpmnXml, roles}]. */
const altFlowsFor = (diagDir, uc) => (uc.altFlows ?? []).map((f) => ({ ...f, ...bpmnFor(diagDir, f) }));

/** Capabilities of a rule/quirk/gap: `Capabilities:` list, `Spec: capabilities/<cap>/…`, or `Affects: <cap> (…)`. */
function itemCapabilities(item, known) {
  const f = item.fields;
  const fromList = (f.Capabilities ?? "").split(",").map((s) => s.trim());
  const fromSpec = [...(f.Spec ?? "").matchAll(/capabilities\/([a-z0-9-]+)\//g)].map((m) => m[1]);
  const fromAffects = (f.Affects ?? "").split(/[,;]/).map((s) => s.trim().split(/[\s(]/)[0]);
  return [...new Set([...fromList, ...fromSpec, ...fromAffects])].filter((c) => known.has(c));
}

export const packageTitle = (pkgDir) => (readIf(join(pkgDir, "README.md")).match(/^# (.+)$/m)?.[1] ?? "Rebuild package").trim();

const UI_LINE_RE = /(?<![\w-])ui:\s*([\w.-]+)#([\w.-]+)/g;
/** `ui: <screen>#<action>` lines of a use case's flows -> keys; unknown ones reported. */
function uiActionsOf(uc, ui, errors) {
  const xml = [uc.bpmnXml, ...uc.altFlows.map((f) => f.bpmnXml)].filter(Boolean).join("\n");
  const keys = [...new Set([...xml.matchAll(UI_LINE_RE)].map((m) => `${m[1]}#${m[2]}`))];
  for (const k of keys) {
    const [sid, aid] = k.split("#");
    if (!ui.screens.find((s) => s.id === sid)?.actions?.some((a) => a.id === aid)) errors.push(`${uc.id}: ui line names unknown screen action ${k}`);
  }
  return keys;
}

/** Shared: which actions/use cases each log type evidences. Local only: per-customer counts (_local/usage/usage.json). */
function usageData(pkgDir, mapping, local) {
  const shared = { mapping: (mapping.types ?? []).map(({ type, kind, actions, useCases, cite }) => ({ type, kind, actions: actions ?? [], useCases: useCases ?? [], cite })) };
  const f = join(pkgDir, "_local", "usage", "usage.json");
  return local && existsSync(f) ? { ...shared, ...JSON.parse(readFileSync(f, "utf8")) } : shared;
}

/** Gated optional analyses over the UI model: use-case links (merged first), CRUD, variability, usage. */
function addAnalyses(pkgDir, data, { ui, model, local }, errors) {
  const links = readLinks(pkgDir);
  if (links) errors.push(...checkLinks(ui, data.useCases, links));
  data.useCases = data.useCases.map((uc) => mergeLinks(uc, links?.find((r) => r.useCase === uc.id)));
  const crud = readCrud(pkgDir);
  if (crud) errors.push(...checkCrud(ui, model, crud));
  data.crud = crud && !errors.length ? crudData(ui, data.useCases, model, crud) : null;
  const variability = readVariability(pkgDir);
  const inputs = variability && readConfigInputs(pkgDir);
  if (variability) errors.push(...checkVariability(pkgDir, ui, inputs, variability));
  data.variability = variability && !errors.length ? variabilityData(inputs, variability) : null;
  const mapping = readMapping(pkgDir);
  if (mapping) errors.push(...checkUsage(ui, data.useCases, mapping));
  data.usage = mapping && !errors.length ? usageData(pkgDir, mapping, local) : null;
}

/** Assemble the catalog data object. Returns {data, errors}. */
export function buildCatalog(pkgDir, { local = false, budget = DEFAULT_BUDGET } = {}) {
  const errors = [];
  const diagDir = join(pkgDir, "diagrams");
  const model = extractModel(readIf(join(pkgDir, "model.md")));
  const items = {
    ...parseCatalog(readIf(join(pkgDir, "rules.md")), "BR"),
    ...parseCatalog(readIf(join(pkgDir, "quirks.md")), "QUIRK"),
    ...parseCatalog(readIf(join(pkgDir, "gaps.md")), "GAP"),
  };
  const capabilities = readCapabilities(pkgDir);
  const known = new Set(Object.keys(capabilities));
  for (const it of Object.values(items)) it.capabilities = itemCapabilities(it, known);
  const ucPath = join(diagDir, "use-cases.json");
  const useCases = existsSync(ucPath) ? JSON.parse(readFileSync(ucPath, "utf8")) : [];
  const entities = Object.fromEntries(
    model.entities.map((e) => [
      e.name,
      {
        capabilities: e.capabilities,
        identity: e.identity,
        persistence: e.persistence,
        relationships: e.relationships,
        fields: e.fields.map(({ name, type, required, nullable }) => ({ name, type, required, nullable })),
      },
    ]),
  );
  const qPath = join(diagDir, "questions.json");
  const questions = existsSync(qPath) ? JSON.parse(readFileSync(qPath, "utf8")) : [];
  errors.push(...checkQuestions(pkgDir, questions));
  errors.push(...checkUseCases(pkgDir, useCases, model));
  const ui = readUi(pkgDir);
  errors.push(...checkUi(pkgDir, ui));
  const title = packageTitle(pkgDir);
  const arch = readArch(pkgDir);
  if (arch) errors.push(...checkArch(pkgDir, arch));
  const beh = behaviourData(pkgDir, { local, budget });
  errors.push(...beh.errors);
  const data = {
    meta: { title, built: new Date().toISOString().slice(0, 10), budget },
    capabilities,
    items,
    entities,
    er: readEr(diagDir, model, errors),
    questions,
    ui,
    useCases: useCases.map((uc) => {
      const b = bpmnFor(diagDir, uc);
      const docRefs = b.bpmnXml ? [...new Set(b.bpmnXml.match(REF_RE) ?? [])] : [];
      const full = { ...uc, ...b, altFlows: altFlowsFor(diagDir, uc), bpmnRefs: docRefs.filter((r) => items[r]) };
      return { ...full, uiActions: uiActionsOf(full, ui, errors) };
    }),
    ...ifmlData(ui, title, budget),
    behaviour: beh.behaviour || { sequences: [], states: [], objects: [] },
    arch: arch && !errors.length ? { model: arch, views: archViews(arch), dsl: toStructurizr(arch, title), c4: toMermaidC4(arch, title) } : null,
  };
  addAnalyses(pkgDir, data, { ui, model, local }, errors);
  return { data, errors };
}

/** IFML graph + XMI when the package has a UI model. */
const ifmlData = (ui, title, budget) => {
  if (!ui.screens.length) return { ifml: null, ifmlXmi: "", ifmlSplit: null };
  const ifml = buildIfml(ui);
  return { ifml, ifmlXmi: ifmlToXmi(ifml, title), ifmlSplit: ifmlParts(ui, budget, title) };
};

const inlineScript = (s) => s.replace(/<\/script/gi, "<\\/script");

/** Render the HTML page; `libs` = {bpmnJs, bpmnCss[], mermaid} file contents (any may be empty). */
export function renderSite(data, libs) {
  const viewers = { bpmn: Boolean(libs.bpmnJs), mermaid: Boolean(libs.mermaid), ifml: Boolean(libs.ifmlJs) };
  const json = JSON.stringify({ ...data, viewers }).replace(/</g, "\\u003c");
  const parts = {
    "/*__CSS__*/": readFileSync(join(TEMPLATES, "catalog.css"), "utf8"),
    "/*__BPMN_CSS__*/": libs.bpmnCss.join("\n").replace(/<\/style/gi, "<\\/style"),
    "/*__BPMN_JS__*/": inlineScript(libs.bpmnJs),
    "/*__MERMAID_JS__*/": inlineScript(libs.mermaid),
    "/*__IFML_JS__*/": inlineScript(libs.ifmlJs ?? ""),
    "/*__IFML_CSS__*/": (libs.ifmlCss ?? []).join("\n").replace(/<\/style/gi, "<\\/style"),
    // erChunks runs in the page too (entity sets are chosen there): same source as the tested function.
    "/*__APP_JS__*/": inlineScript(`${erChunks.toString()}\n${readFileSync(join(TEMPLATES, "catalog.js"), "utf8")}`),
    '"__DATA__"': json,
    "__TITLE__": data.meta.title.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;")),
  };
  // Single pass: inserted library text is never rescanned for placeholders.
  const keys = Object.keys(parts).map((k) => k.replace(/[*/]/g, "\\$&"));
  return readFileSync(join(TEMPLATES, "catalog.html"), "utf8").replace(new RegExp(keys.join("|"), "g"), (k) => parts[k]);
}
