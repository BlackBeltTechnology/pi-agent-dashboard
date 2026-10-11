#!/usr/bin/env node
// Style kit: the application's own CSS -> design tokens + tokenized stylesheet + named components.
// usage: style-kit.mjs <appDir> <adapter> <job.json> <outDir>   (writes style-kit.json, style-kit.css)
// Deterministic; every token and component carries file:line cites into the app.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { adapterOrExit, readText } from "./lib.mjs";

const NAMED = {
  white: "#ffffff", black: "#000000", red: "#ff0000", green: "#008000", blue: "#0000ff", gray: "#808080", grey: "#808080",
  silver: "#c0c0c0", yellow: "#ffff00", orange: "#ffa500", lightgray: "#d3d3d3", lightgrey: "#d3d3d3", darkgray: "#a9a9a9",
  darkgrey: "#a9a9a9", whitesmoke: "#f5f5f5", gainsboro: "#dcdcdc", navy: "#000080", maroon: "#800000", purple: "#800080",
};
const COLOR_RE = new RegExp(`#[0-9a-fA-F]{3,8}\\b|rgba?\\([^)]*\\)|\\b(?:${Object.keys(NAMED).join("|")})\\b`, "gi");
const COLOR_PROPS = /^(color|background(-color|-image)?|border(-(top|right|bottom|left))?(-color)?|outline(-color)?|box-shadow|text-shadow|fill|stroke|column-rule(-color)?)$/i;

/** Blank comments, keeping newlines so line numbers stay true. */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));

/** Split on `sep` outside parentheses and quotes. */
const PAREN = { "(": 1, ")": -1 };
function splitTop(s, sep) {
  const out = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) quote = ch === quote ? null : quote;
    else if (ch === '"' || ch === "'") quote = ch;
    else if (PAREN[ch]) depth += PAREN[ch];
    else if (ch === sep && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

/** Index just past the `}` closing the block opened at `open`. */
function blockEnd(css, open) {
  let depth = 1;
  let j = open + 1;
  while (j < css.length && depth) {
    depth += css[j] === "{" ? 1 : css[j] === "}" ? -1 : 0;
    j++;
  }
  return j;
}

/** Declarations of a rule body; a declaration without ':' is invalid CSS (e.g. a `//` "comment") and dropped, as browsers do. */
const parseDecls = (body) =>
  splitTop(body, ";")
    .map((d) => d.trim())
    .filter((d) => d.includes(":"))
    .map((d) => [d.slice(0, d.indexOf(":")).trim().toLowerCase(), d.slice(d.indexOf(":") + 1).trim()])
    .filter(([p]) => p);

/** One block: @media/@supports nest, @font-face is marked, other at-rules stay raw, rules get declarations. */
function blockItem(sel, body, line, bodyLine) {
  if (/^@(media|supports)/i.test(sel)) return { at: sel, rules: parseCss(body, bodyLine), line };
  if (/^@font-face/i.test(sel)) return { fontFace: true, line };
  if (sel.startsWith("@")) return { raw: `${sel} {${body}}`, line };
  return sel ? { selector: sel, decls: parseDecls(body), line } : null;
}

/** Parse CSS into [{selector, decls:[[prop, value]], line} | {at, prelude, rules, line} | {raw, line}]. */
function parseCss(css, offsetLine = 1) {
  const items = [];
  let i = 0;
  const lineOf = (idx) => offsetLine + (css.slice(0, idx).match(/\n/g) || []).length;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) break;
    const prelude = css.slice(i, open);
    const lead = prelude.length - prelude.trimStart().length;
    const line = lineOf(i + lead);
    const j = blockEnd(css, open);
    const item = blockItem(prelude.trim().replace(/\s+/g, " "), css.slice(open + 1, j - 1), line, lineOf(open + 1));
    if (item) items.push(item);
    i = j;
  }
  return items;
}

function normColor(c) {
  const s = c.toLowerCase();
  if (NAMED[s]) return NAMED[s];
  if (s.startsWith("#")) return s.length === 4 ? `#${[...s.slice(1)].map((x) => x + x).join("")}` : s;
  const n = s.match(/[\d.]+%?/g) || [];
  const [r, g, b, a] = n.map((x) => (x.endsWith("%") ? Math.round(parseFloat(x) * 2.55) : parseFloat(x)));
  if (a === undefined || a >= 1) return `#${[r, g, b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("")}`;
  return `rgba(${r},${g},${b},${a})`;
}
const colorVar = (v) => `--sk-c-${v.startsWith("#") ? v.slice(1) : v.replace(/^rgba\(|\)$/g, "").split(",").map((x, i) => (i === 3 ? Math.round(x * 100) : x)).join("-")}`;

/** Walk every rule (incl. inside @media). */
function* rules(items) {
  for (const it of items) {
    if (it.rules) yield* rules(it.rules);
    else if (it.selector) yield it;
  }
}

/** Count one use of `key` (uses + at most 5 distinct cites). */
function bump(map, key, cite) {
  const t = map.get(key) || { value: key, uses: 0, cites: [] };
  t.uses += 1;
  if (t.cites.length < 5 && !t.cites.includes(cite)) t.cites.push(cite);
  map.set(key, t);
}

/** Token uses of one declaration. */
function countDecl(m, p, v, cite) {
  const plain = v.replace(/\s*!important/i, "");
  if (COLOR_PROPS.test(p)) for (const c of v.replace(/url\([^)]*\)/gi, "").match(COLOR_RE) || []) bump(m.colors, normColor(c), cite);
  if (p === "font-family") bump(m.fonts, plain.trim(), cite);
  if (p === "font-size") bump(m.fontSize, plain, cite);
  if (p === "border-radius") bump(m.radius, plain, cite);
}

function collectTokens(parsed) {
  const m = { colors: new Map(), fonts: new Map(), fontSize: new Map(), radius: new Map() };
  for (const { file, items } of parsed) for (const r of rules(items)) for (const [p, v] of r.decls) countDecl(m, p, v, `${file}:${r.line}`);
  const sorted = (m) => [...m.values()].sort((a, b) => b.uses - a.uses || String(a.value).localeCompare(String(b.value)));
  const color = sorted(m.colors).map((t) => ({ name: colorVar(t.value), ...t }));
  const font = sorted(m.fonts).map((t, i) => ({ name: `--sk-font-${i + 1}`, ...t }));
  return { color, font, fontSize: sorted(m.fontSize), radius: sorted(m.radius) };
}

/** Replace colour literals and font stacks in one declaration with token references. */
function tokenizeDecl([p, v], fontVar) {
  if (p === "font-family") {
    const imp = /!important/i.test(v) ? " !important" : "";
    return [p, `var(${fontVar.get(v.replace(/\s*!important/i, "").trim())})${imp}`];
  }
  if (!COLOR_PROPS.test(p)) return [p, v];
  const urls = [];
  const masked = v.replace(/url\([^)]*\)/gi, (u) => `\u0000${urls.push(u) - 1}\u0000`);
  const out = masked.replace(COLOR_RE, (c) => `var(${colorVar(normColor(c))})`).replace(/\u0000(\d+)\u0000/g, (_, i) => urls[i]);
  return [p, out];
}

const ruleCss = (selector, decls) => `${selector} { ${decls.map(([p, v]) => `${p}: ${v};`).join(" ")} }`;

function emitItems(items, tok, pad = "") {
  return items
    .map((it) => {
      if (it.rules) return `${pad}${it.at} {\n${emitItems(it.rules, tok, `${pad}  `)}\n${pad}}`;
      if (it.raw) return `${pad}${it.raw}`;
      if (it.selector) return `${pad}${ruleCss(it.selector, it.decls.map(tok))}`;
      return null;
    })
    .filter(Boolean)
    .join("\n");
}

/** Components from job.components {name: [selector...]}: exact selector match in a top-level rule list. */
function collectComponents(parsed, job, tok) {
  const out = {};
  for (const [name, selectors] of Object.entries(job.components || {})) {
    out[name] = selectors.map((sel) => {
      for (const { file, items } of parsed)
        for (const it of items)
          if (it.selector?.split(",").map((s) => s.trim()).includes(sel))
            return { selector: sel, decls: it.decls.map(tok), cite: `${file}:${it.line}` };
      throw new Error(`${name}: selector ${sel} not found`);
    });
  }
  return out;
}

/** files = {path: cssText}; job = {components}. Returns {sources, tokens, components, css}. */
export function buildKit(files, job) {
  const parsed = Object.entries(files).map(([file, text]) => ({ file, items: parseCss(stripComments(text)) }));
  const tokens = collectTokens(parsed);
  const fontVar = new Map(tokens.font.map((t) => [t.value, t.name]));
  const tok = (d) => tokenizeDecl(d, fontVar);
  const components = collectComponents(parsed, job, tok);
  const base = parsed.flatMap(({ items }) => [...rules(items)]).find((r) => /^(html|body)$/.test(r.selector) && r.decls.some(([p]) => p === "font-family"));
  const baseFont = base?.decls.find(([p]) => p === "font-family")[1].replace(/\s*!important/i, "").trim();
  const aliases = [];
  if (baseFont) aliases.push(`  --sk-font-base: ${fontVar.has(baseFont) ? `var(${fontVar.get(baseFont)})` : baseFont};`);
  for (const [name, parts] of Object.entries(components)) {
    const d = Object.fromEntries(parts[0].decls);
    const bg = d["background-color"] || d.background;
    if (d.color?.startsWith("var(")) aliases.push(`  --sk-${name}-fg: ${d.color.match(/var\([^)]*\)/)[0]};`);
    if (bg?.includes("var(")) aliases.push(`  --sk-${name}-bg: ${bg.match(/var\([^)]*\)/)[0]};`);
  }
  const root = [":root {", ...tokens.color.map((t) => `  ${t.name}: ${t.value};`), ...tokens.font.map((t) => `  ${t.name}: ${t.value};`), ...aliases, "}"];
  const comp = Object.entries(components).flatMap(([name, parts]) => parts.map((p) => ruleCss(p.selector.replace(/^[^\s>+~]+/, `.sk-${name}`), p.decls)));
  const app = parsed.map(({ file, items }) => `/* ${file} */\n${emitItems(items, tok)}`);
  const css = [`/* style kit — generated, do not edit */`, ...root, "/* components */", ...comp, "/* application styles (tokenized) */", ...app].join("\n");
  return { sources: Object.keys(files), tokens, components, css };
}

async function main([appDir, adapterName, jobFile, outDir]) {
  if (!outDir) {
    process.stderr.write("usage: style-kit.mjs <appDir> <adapter> <job.json> <outDir>\n");
    return 2;
  }
  const adapter = await adapterOrExit(adapterName);
  const job = JSON.parse(readText(jobFile));
  const files = Object.fromEntries(adapter.styleSources(appDir, readText).map((f) => [f, readText(join(appDir, f))]));
  const kit = buildKit(files, job);
  mkdirSync(outDir, { recursive: true });
  const { css, ...json } = kit;
  writeFileSync(join(outDir, "style-kit.json"), `${JSON.stringify(json, null, 1)}\n`);
  writeFileSync(join(outDir, "style-kit.css"), `${css}\n`);
  process.stdout.write(`style kit: ${kit.sources.length} files, ${kit.tokens.color.length} colours, ${kit.tokens.font.length} fonts, ${Object.keys(kit.components).length} components\n`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main(process.argv.slice(2));
