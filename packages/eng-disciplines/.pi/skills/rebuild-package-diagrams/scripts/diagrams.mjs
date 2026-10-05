#!/usr/bin/env node
// Deterministic helpers for the rebuild-package-diagrams skill (Node >= 20, no deps).
//   extract-model <model.md>                 -> JSON {entities:[...]} on stdout
//   render-er <er.json> <model.json>         -> Mermaid erDiagram on stdout; exit 1 + violations on stderr
//   check-trace <file.bpmn> <packageDir>     -> exit 1 + violations when a flow node lacks a resolvable package ref
// Exit 2 on bad usage / unreadable input. See change: add-rebuild-package-diagrams.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const USAGE = `usage:
  diagrams.mjs extract-model <model.md>
  diagrams.mjs render-er <er.json> <model.json>
  diagrams.mjs check-trace <file.bpmn> <packageDir>`;

function die(msg, code = 2) {
  process.stderr.write(`${msg}\n`);
  process.exit(code);
}

function readText(path) {
  if (!existsSync(path)) die(`diagrams: not found: ${path}`);
  return readFileSync(path, "utf8");
}

function readJson(path) {
  try {
    return JSON.parse(readText(path));
  } catch (e) {
    return die(`diagrams: invalid JSON: ${path}: ${e.message}`);
  }
}

// ---------- extract-model ----------

const PERSISTENT_RE = /\b(table|tables|row|rows|collection|colection|database|DB)\b/;
const CONF_RE = /confidence=(\w+)/;

function newEntity(name) {
  return { name, capabilities: [], identity: "", persistence: "", persistent: false, fields: [], relationships: "" };
}

function applyKeyValue(ent, key, value) {
  if (key === "Capabilities") ent.capabilities = value.split(",").map((s) => s.trim()).filter(Boolean);
  else if (key === "Identity") ent.identity = value;
  else if (key === "Relationships") ent.relationships = value;
  else {
    ent.persistence = value;
    ent.persistent = PERSISTENT_RE.test(value);
  }
}

function parseField(m) {
  const rest = m[3] ?? "";
  const flags = rest.split(";")[0];
  return {
    name: m[1],
    type: m[2].trim(),
    required: /\brequired\b/.test(flags),
    nullable: /\bnullable\b/.test(flags),
    confidence: null,
    text: rest,
  };
}

/** Parse a reverse-spec `model.md` into entity records. */
function extractModel(text) {
  const entities = [];
  let cur = null;
  let lastField = null;
  for (const line of text.split("\n")) {
    const head = line.match(/^## (.+?)\s*$/);
    if (head) {
      cur = newEntity(head[1]);
      entities.push(cur);
      lastField = null;
      continue;
    }
    if (!cur) continue;
    const kv = line.match(/^(Capabilities|Identity|Persistence|Relationships):\s*(.*)$/);
    const field = line.match(/^- `([^`]+)` — ([^;]*)(?:;\s*(.*))?$/);
    if (kv) {
      applyKeyValue(cur, kv[1], kv[2]);
      lastField = null;
    } else if (field) {
      lastField = parseField(field);
      cur.fields.push(lastField);
    } else if (lastField?.confidence === null && /^\s+<!-- cite:/.test(line)) {
      lastField.confidence = line.match(CONF_RE)?.[1] ?? null;
    }
  }
  return { entities };
}

// ---------- render-er ----------

const CARD = {
  "1:1": "||--||",
  "1:0..1": "||--o|",
  "1:N": "||--o{",
  "1:1..N": "||--|{",
  "0..1:N": "|o--o{",
  "0..1:1": "|o--||",
  "N:1": "}o--||",
  "N:0..1": "}o--o|",
  "N:M": "}o--o{",
};

const ident = (s) => s.replace(/[^A-Za-z0-9_]/g, "_");
const quote = (s) => String(s).replace(/"/g, "'");

function renderEntity(ent, model, errors) {
  if (!model) {
    errors.push(`entity not in model: ${ent.name}`);
    return null;
  }
  const fieldMap = new Map(model.fields.map((f) => [f.name, f]));
  const attrs = [];
  for (const f of ent.fields ?? []) {
    const mf = fieldMap.get(f.name);
    if (!mf) {
      errors.push(`field not in model: ${ent.name}.${f.name}`);
      continue;
    }
    const type = ident(f.type ?? mf.type.split(/[\s(|<]/)[0]) || "any";
    const key = f.key ? ` ${f.key}` : "";
    const comment = f.comment ? ` "${quote(f.comment)}"` : "";
    attrs.push(`    ${type} ${ident(f.name)}${key}${comment}`);
  }
  return `  ${ident(ent.name)} {\n${attrs.map((x) => `${x}\n`).join("")}  }`;
}

function relationError(r, a, b, drawn) {
  const tag = `${r.from} -> ${r.to}`;
  if (!a || !b) return `relation endpoint not in model: ${tag}`;
  if (!drawn.has(r.from) || !drawn.has(r.to)) return `relation endpoint not drawn in er.json entities: ${tag}`;
  if (!CARD[r.cardinality])
    return `relation ${tag}: unknown cardinality "${r.cardinality}" (allowed: ${Object.keys(CARD).join(", ")})`;
  const ev = String(r.evidence ?? "").trim();
  const hay = `${a.relationships}\n${b.relationships}`.toLowerCase();
  const fieldHit = [...a.fields, ...b.fields].some((f) => f.name === ev);
  if (!ev || !(fieldHit || hay.includes(ev.toLowerCase())))
    return `relation ${tag}: evidence not found in either endpoint's relationships or field names: "${ev}"`;
  return null;
}

/** Validate er.json against the extracted model; return {errors, mermaid}. */
function renderEr(er, model) {
  const errors = [];
  const byName = new Map(model.entities.map((e) => [e.name, e]));
  const lines = ["erDiagram"];
  for (const ent of er.entities ?? []) {
    const block = renderEntity(ent, byName.get(ent.name), errors);
    if (block) lines.push(block);
  }
  const drawn = new Set((er.entities ?? []).map((e) => e.name));
  for (const r of er.relations ?? []) {
    const err = relationError(r, byName.get(r.from), byName.get(r.to), drawn);
    if (err) {
      errors.push(err);
      continue;
    }
    const conn = CARD[r.cardinality];
    const c = r.confidence === "confirmed" ? conn : conn.replace("--", "..");
    lines.push(`  ${ident(r.from)} ${c} ${ident(r.to)} : "${quote(r.label ?? "")}"`);
  }
  return { errors, mermaid: `${lines.join("\n")}\n` };
}

// ---------- check-trace ----------

const NODE_RE =
  /<(?:\w+:)?(task|userTask|serviceTask|businessRuleTask|manualTask|scriptTask|sendTask|receiveTask|callActivity|exclusiveGateway|parallelGateway|inclusiveGateway|eventBasedGateway|intermediateCatchEvent|intermediateThrowEvent|boundaryEvent)\b([^>]*?)(\/>|>([\s\S]*?)<\/(?:\w+:)?\1>)/g;
const DOC_RE = /<(?:\w+:)?documentation[^>]*>([\s\S]*?)<\/(?:\w+:)?documentation>/;
const ID_REF_RE = /\b(BR|QUIRK|GAP)-\d+\b/g;
const SPEC_REF_RE = /spec:([a-z0-9][a-z0-9-]*)#([^;\n<]+)/g;

const decode = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Build a resolver: ref string -> true when it exists in the package. */
function packageResolver(pkgDir) {
  const catalogs = {
    BR: readIf(join(pkgDir, "rules.md")),
    QUIRK: readIf(join(pkgDir, "quirks.md")),
    GAP: readIf(join(pkgDir, "gaps.md")),
  };
  const reqCache = new Map();
  const requirements = (cap) => {
    if (!reqCache.has(cap)) {
      const spec = readIf(join(pkgDir, "capabilities", cap, "spec.md"));
      reqCache.set(cap, new Set([...spec.matchAll(/^### Requirement:\s*(.+?)\s*$/gm)].map((m) => m[1])));
    }
    return reqCache.get(cap);
  };
  return {
    id: (ref) => new RegExp(`^## ${ref}\\b`, "m").test(catalogs[ref.split("-")[0]]),
    spec: (cap, req) => requirements(cap).has(req),
  };
}

/** Violations for one matched flow node. */
function nodeErrors(m, resolve) {
  const id = m[2].match(/\bid="([^"]+)"/)?.[1] ?? `<${m[1]}>`;
  const doc = decode((m[4] ?? "").match(DOC_RE)?.[1] ?? "");
  const ids = [...doc.matchAll(ID_REF_RE)].map((x) => x[0]);
  const specs = [...doc.matchAll(SPEC_REF_RE)].map((x) => [x[1], x[2].trim()]);
  if (!ids.length && !specs.length)
    return [`${id}: no package ref in documentation (need BR-/QUIRK-/GAP- id or spec:<cap>#<Requirement>)`];
  return [
    ...ids.filter((ref) => !resolve.id(ref)).map((ref) => `${id}: dangling ref ${ref}`),
    ...specs.filter(([cap, req]) => !resolve.spec(cap, req)).map(([cap, req]) => `${id}: dangling ref spec:${cap}#${req}`),
  ];
}

/** Return violations for a BPMN file against a rebuild package directory. */
function checkTrace(xml, pkgDir) {
  const resolve = packageResolver(pkgDir);
  return [...xml.matchAll(NODE_RE)].flatMap((m) => nodeErrors(m, resolve));
}

function readIf(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

// ---------- CLI ----------

function main(argv) {
  const [cmd, a, b] = argv;
  if (cmd === "extract-model" && a) {
    process.stdout.write(`${JSON.stringify(extractModel(readText(a)), null, 1)}\n`);
    return 0;
  }
  if (cmd === "render-er" && a && b) {
    const { errors, mermaid } = renderEr(readJson(a), readJson(b));
    if (errors.length) {
      process.stderr.write(`${errors.join("\n")}\n`);
      return 1;
    }
    process.stdout.write(mermaid);
    return 0;
  }
  if (cmd === "check-trace" && a && b) {
    if (!existsSync(b)) die(`diagrams: not found: ${b}`);
    const errors = checkTrace(readText(a), b);
    if (errors.length) {
      process.stderr.write(`${errors.join("\n")}\n`);
      return 1;
    }
    return 0;
  }
  die(USAGE);
}

process.exitCode = main(process.argv.slice(2));
