// build-site: assemble a rebuild package + its diagrams into one self-contained HTML catalog.
// See change: add-rebuild-package-diagrams.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CARD, extractModel, parseCatalog, parseRoles, parseSpec, readIf, renderEr } from "./lib.mjs";

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
  }
  return { entities, relations };
}

function bpmnFor(diagDir, uc) {
  if (!uc.bpmn) return { bpmnXml: null, roles: [] };
  const file = join(diagDir, uc.bpmn);
  const xml = readIf(file);
  return { bpmnXml: xml || null, roles: parseRoles(readIf(join(dirname(file), "package.yaml"))) };
}

/** Assemble the catalog data object. Returns {data, errors}. */
export function buildCatalog(pkgDir) {
  const errors = [];
  const diagDir = join(pkgDir, "diagrams");
  const model = extractModel(readIf(join(pkgDir, "model.md")));
  const items = {
    ...parseCatalog(readIf(join(pkgDir, "rules.md")), "BR"),
    ...parseCatalog(readIf(join(pkgDir, "quirks.md")), "QUIRK"),
    ...parseCatalog(readIf(join(pkgDir, "gaps.md")), "GAP"),
  };
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
  const title = (readIf(join(pkgDir, "README.md")).match(/^# (.+)$/m)?.[1] ?? "Rebuild package").trim();
  const data = {
    meta: { title, built: new Date().toISOString().slice(0, 10) },
    capabilities: readCapabilities(pkgDir),
    items,
    entities,
    er: readEr(diagDir, model, errors),
    useCases: useCases.map((uc) => {
      const b = bpmnFor(diagDir, uc);
      const docRefs = b.bpmnXml ? [...new Set(b.bpmnXml.match(REF_RE) ?? [])] : [];
      return { ...uc, ...b, bpmnRefs: docRefs.filter((r) => items[r]) };
    }),
  };
  return { data, errors };
}

const inlineScript = (s) => s.replace(/<\/script/gi, "<\\/script");

/** Render the HTML page; `libs` = {bpmnJs, bpmnCss[], mermaid} file contents (any may be empty). */
export function renderSite(data, libs) {
  const viewers = { bpmn: Boolean(libs.bpmnJs), mermaid: Boolean(libs.mermaid) };
  const json = JSON.stringify({ ...data, viewers }).replace(/</g, "\\u003c");
  const parts = {
    "/*__CSS__*/": readFileSync(join(TEMPLATES, "catalog.css"), "utf8"),
    "/*__BPMN_CSS__*/": libs.bpmnCss.join("\n").replace(/<\/style/gi, "<\\/style"),
    "/*__BPMN_JS__*/": inlineScript(libs.bpmnJs),
    "/*__MERMAID_JS__*/": inlineScript(libs.mermaid),
    "/*__APP_JS__*/": inlineScript(readFileSync(join(TEMPLATES, "catalog.js"), "utf8")),
    '"__DATA__"': json,
    "__TITLE__": data.meta.title.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;")),
  };
  // Single pass: inserted library text is never rescanned for placeholders.
  const keys = Object.keys(parts).map((k) => k.replace(/[*/]/g, "\\$&"));
  return readFileSync(join(TEMPLATES, "catalog.html"), "utf8").replace(new RegExp(keys.join("|"), "g"), (k) => parts[k]);
}
