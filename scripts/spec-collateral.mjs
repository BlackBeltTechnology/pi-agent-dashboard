#!/usr/bin/env node
/**
 * spec-collateral — advisory scan listing main-spec requirements an OpenSpec
 * change may contradict after archive (change: add-spec-collateral-scan).
 *
 *   node scripts/spec-collateral.mjs --change <name> [--specs <dir>] [--top <n>] [--json]
 *
 * T1 = capabilities outside the delta whose best requirement names identifiers
 * the change touches; T2 = unmodified requirements inside delta capabilities
 * that do (ADDED-where-MODIFIED). Paths resolve from the cwd (run from the repo
 * root). Exit 0 on a completed scan whatever it finds; 2 on any failure; never
 * 1 — a failed scan must never read as a gate verdict.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const OPENSPEC_STOP = new Set([
  "ADDED",
  "MODIFIED",
  "REMOVED",
  "RENAMED",
  "REQUIREMENTS",
  "SHALL",
  "MUST",
  "WHEN",
  "THEN",
  "GIVEN",
  "SHOULD",
  "e.g",
  "i.e",
]);
const INTENT =
  /\b(remov(e|es|ed|ing|al)|replac(e|es|ed|ing|ement)|renam(e|es|ed|ing)|drop(s|ped|ping)?|retir(e|es|ed|ing|ement)|hid(e|es|den|ing)|narrow(s|ed|ing)?|forbid(s|den|ding)?)\b/i;
const LEAD_PUNCT = /^[[\](){}<>"'“”‘’,;!?*~]+/;
const TRAIL_PUNCT = /[[\](){}<>"'“”‘’,;:!?.*~]+$/;
const CITATION = /:\d+(?:-\d+)?$/;
const WORD_CHAR = /[A-Za-z0-9_-]/;

/** Code-shaped test (design D1). Expects a stripped token. */
function isCodeShaped(tok) {
  if (!/[A-Za-z]/.test(tok) || OPENSPEC_STOP.has(tok)) return false;
  if (/^--[A-Za-z0-9]+$/.test(tok)) return false; // bare CLI flag (`--json`)
  if (/[_/@:.]/.test(tok)) return true;
  if (tok.length >= 6 && /^[A-Za-z0-9]+$/.test(tok) && /[a-z][A-Z]/.test(tok)) return true;
  if (/^[A-Z][A-Z0-9_]{4,}$/.test(tok)) return true;
  if (/^[-A-Za-z0-9]+$/.test(tok) && (tok.match(/-/g) ?? []).length >= 2) return true;
  return false;
}

function strip(raw) {
  let t = raw.replace(LEAD_PUNCT, "").replace(TRAIL_PUNCT, "");
  t = t.replace(CITATION, "").replace(TRAIL_PUNCT, "");
  return t;
}

/** Normalise one raw token into zero or more identifiers. */
function identifiersOf(raw) {
  const tok = strip(raw);
  if (!tok || !isCodeShaped(tok)) return [];
  if (!tok.includes("/") || tok.startsWith("@") || tok.startsWith("/api/")) return [tok];
  const base = tok.split("/").filter(Boolean).pop() ?? "";
  const out = [];
  if (base && isCodeShaped(base)) out.push(base);
  const dot = base.lastIndexOf(".");
  if (dot > 0) {
    const stem = base.slice(0, dot);
    if (isCodeShaped(stem)) out.push(stem);
  }
  return out;
}

/** Split text into sentences: list items, headings, table rows and blank lines start one; `.!?` + whitespace end one. */
function sentences(text) {
  const blocks = [];
  let cur = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*$/.test(line) || /^\s*([-*+]\s|\d+\.\s|#|\|)/.test(line)) {
      if (cur.length) blocks.push(cur.join("\n"));
      cur = [];
    }
    if (!/^\s*$/.test(line)) cur.push(line);
  }
  if (cur.length) blocks.push(cur.join("\n"));
  return blocks.flatMap((b) => b.split(/(?<=[.!?])\s+/));
}

/** @returns {Map<string, number>} identifier → intent multiplier (3 if any occurrence sits in a remove/replace/… sentence, else 1). */
export function extractIdentifiers(text) {
  const ids = new Map();
  for (const sentence of sentences(text)) {
    const mult = INTENT.test(sentence) ? 3 : 1;
    for (const raw of sentence.replace(/`/g, " ").split(/[\s|,;]+/)) {
      for (const id of identifiersOf(raw)) ids.set(id, Math.max(ids.get(id) ?? 0, mult));
    }
  }
  return ids;
}

/** @returns {{ name: string, body: string }[]} requirement blocks (body includes the heading line). */
export function parseRequirements(specText) {
  const out = [];
  let cur = null;
  for (const line of specText.split(/\r?\n/)) {
    const m = /^###\s+Requirement:\s*(.+?)\s*$/.exec(line);
    if (m) {
      if (cur) out.push(cur);
      cur = { name: m[1], body: `${line}\n` };
    } else if (/^##\s/.test(line)) {
      if (cur) out.push(cur);
      cur = null;
    } else if (cur) cur.body += `${line}\n`;
  }
  if (cur) out.push(cur);
  return out;
}

/** Requirement names a delta leaves non-live: under `## MODIFIED` / `## REMOVED`, plus `FROM:` names under `## RENAMED`. */
export function deltaTouchedRequirements(deltaText) {
  const names = new Set();
  let section = "";
  for (const line of deltaText.split(/\r?\n/)) {
    const h = /^##\s+(\w+)/.exec(line);
    if (h) {
      section = h[1].toUpperCase();
      continue;
    }
    if (section === "MODIFIED" || section === "REMOVED") {
      const m = /^###\s+Requirement:\s*(.+?)\s*$/.exec(line);
      if (m) names.add(m[1]);
    } else if (section === "RENAMED") {
      const m = /FROM:\s*`?\s*(?:###\s*Requirement:\s*)?([^`]+?)\s*`?\s*$/.exec(line);
      if (m) names.add(m[1]);
    }
  }
  return names;
}

/** Token-bounded occurrence: neighbours are not `[A-Za-z0-9_-]`. */
function occurs(text, id) {
  let i = text.indexOf(id);
  while (i !== -1) {
    const before = i > 0 ? text[i - 1] : "";
    const after = text[i + id.length] ?? "";
    if (!WORD_CHAR.test(before) && !WORD_CHAR.test(after)) return true;
    i = text.indexOf(id, i + 1);
  }
  return false;
}

const round = (x) => Math.round(x * 1e4) / 1e4;
const byRank = (a, b) =>
  b.score - a.score ||
  a.capability.localeCompare(b.capability) ||
  a.requirement.localeCompare(b.requirement);

/**
 * @param {object} p
 * @param {Map<string, number>} p.identifiers  from extractIdentifiers
 * @param {{ capability: string, text?: string, path?: string }[]} p.mainSpecs
 * @param {string[]} [p.deltaCaps]  capabilities the change's delta names
 * @param {Record<string, string>} [p.deltaTexts]  capability → delta spec text
 * @param {number} [p.top]
 * @param {(path: string) => string} [p.readFile]  used for entries without `text`; called once per spec
 */
export function scanCollateral({ identifiers, mainSpecs, deltaCaps, deltaTexts = {}, top = 10, readFile }) {
  const caps = new Set(deltaCaps ?? Object.keys(deltaTexts));
  const read = readFile ?? ((p) => readFileSync(p, "utf8"));
  const specs = mainSpecs.map((s) => {
    const text = s.text ?? read(s.path);
    return { capability: s.capability, text, reqs: parseRequirements(text) };
  });
  const excluded = new Set([...specs.map((s) => s.capability), ...caps]);
  const n = specs.length;
  const dfCap = Math.max(2, Math.floor(0.04 * n));

  const weights = new Map();
  for (const [id, mult] of identifiers) {
    if (excluded.has(id)) continue;
    let df = 0;
    for (const s of specs) if (occurs(s.text, id)) df++;
    if (df === 0 || df > dfCap) continue;
    weights.set(id, round(Math.log(n / df) * mult));
  }

  const t1 = [];
  const t2 = [];
  for (const s of specs) {
    const inDelta = caps.has(s.capability);
    const touched = inDelta ? deltaTouchedRequirements(deltaTexts[s.capability] ?? "") : null;
    const scored = [];
    for (const r of s.reqs) {
      if (touched?.has(r.name)) continue;
      const matched = [...weights.keys()].filter((id) => occurs(r.body, id)).sort();
      if (!matched.length) continue;
      const score = round(matched.reduce((acc, id) => acc + weights.get(id), 0));
      scored.push({ capability: s.capability, requirement: r.name, score, identifiers: matched });
    }
    if (inDelta) t2.push(...scored);
    else if (scored.length) t1.push(scored.sort(byRank)[0]);
  }
  const limit = (list) => {
    list.sort(byRank);
    return { entries: list.slice(0, top), omitted: Math.max(0, list.length - top) };
  };
  const ids = [...weights].map(([id, weight]) => ({ id, weight }));
  ids.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
  return { t1: limit(t1), t2: limit(t2), identifiers: ids };
}

const cell = (s) => String(s).replace(/\|/g, "\\|");

export function renderMarkdown(result, change = "") {
  const lines = [`## Spec-collateral scan${change ? ` — \`${change}\`` : ""}`, ""];
  lines.push("Advisory candidates only: check each; the scan decides nothing and misses prose-only conflicts.", "");
  const table = (title, list, reqHeader) => {
    lines.push(`### ${title}`, "");
    if (!list.entries.length) lines.push("_none_");
    else {
      lines.push(`| # | Capability | ${reqHeader} | Score | Identifiers |`, "|---|---|---|---|---|");
      list.entries.forEach((e, i) => {
        const ids = e.identifiers.map((id) => `\`${cell(id)}\``).join(", ");
        lines.push(`| ${i + 1} | ${cell(e.capability)} | ${cell(e.requirement)} | ${e.score} | ${ids} |`);
      });
    }
    lines.push("", `${list.omitted} omitted by the top-N limit.`, "");
  };
  table("T1 — capabilities outside the delta", result.t1, "Best requirement");
  table("T2 — unmodified requirements in delta capabilities", result.t2, "Requirement");
  lines.push("### Identifiers used", "");
  lines.push(result.identifiers.length ? result.identifiers.map((i) => `\`${i.id}\` (${i.weight})`).join(", ") : "_none_");
  return `${lines.join("\n")}\n`;
}

class UsageError extends Error {}

function parseArgs(argv) {
  const opts = { top: 10, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") opts.json = true;
    else if (a === "--change" || a === "--specs" || a === "--top") {
      const v = argv[++i];
      if (v === undefined) throw new UsageError(`${a} needs a value`);
      if (a === "--top") {
        if (!/^\d+$/.test(v) || Number(v) < 1) throw new UsageError(`--top must be a positive integer, got ${v}`);
        opts.top = Number(v);
      } else opts[a.slice(2)] = v;
    } else throw new UsageError(`unknown argument ${a}`);
  }
  if (!opts.change) throw new UsageError("--change <name> is required");
  return opts;
}

function readOrThrow(p) {
  try {
    return readFileSync(p, "utf8");
  } catch (e) {
    throw new Error(`cannot read ${p}: ${e.code ?? e.message}`);
  }
}
const readOptional = (p) => (existsSync(p) ? readOrThrow(p) : "");
const subdirs = (dir) => readdirSync(dir).filter((d) => statSync(join(dir, d)).isDirectory()).sort();

function main(argv) {
  const opts = parseArgs(argv);
  const changeDir = resolve("openspec", "changes", opts.change);
  if (!existsSync(changeDir)) throw new UsageError(`change not found: ${opts.change} (${changeDir})`);
  const specsDir = resolve(opts.specs ?? join("openspec", "specs"));
  if (!existsSync(specsDir)) throw new UsageError(`specs directory not found: ${specsDir}`);

  const texts = ["proposal.md", "design.md", "tasks.md"].map((f) => readOptional(join(changeDir, f)));
  const deltaTexts = {};
  const deltaDir = join(changeDir, "specs");
  if (existsSync(deltaDir)) {
    for (const cap of subdirs(deltaDir)) {
      deltaTexts[cap] = readOptional(join(deltaDir, cap, "spec.md"));
      texts.push(deltaTexts[cap]);
    }
  }
  const identifiers = new Map();
  for (const t of texts) {
    for (const [id, m] of extractIdentifiers(t)) identifiers.set(id, Math.max(identifiers.get(id) ?? 0, m));
  }
  const mainSpecs = subdirs(specsDir)
    .map((capability) => ({ capability, path: join(specsDir, capability, "spec.md") }))
    .filter((s) => existsSync(s.path));
  const result = scanCollateral({ identifiers, mainSpecs, deltaTexts, top: opts.top, readFile: readOrThrow });
  process.stdout.write(opts.json ? `${JSON.stringify(result, null, 2)}\n` : renderMarkdown(result, opts.change));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main(process.argv.slice(2));
    process.exit(0);
  } catch (e) {
    process.stderr.write(`spec-collateral: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(2);
  }
}
