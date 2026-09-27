/**
 * Minimal CSS model for the hidden-HTML layer (design D1).
 *
 * Supported: inline `style` and embedded-stylesheet rules whose selector is a
 * single type, `.class` or `#id` (or a comma list of those). Resolution follows
 * the CSS cascade for that subset: `!important` first, then specificity
 * (type < class < id < inline), then source order. Comments are removed per CSS
 * syntax (`display:/＊＊/none` is `display:none`).
 *
 * Linear by construction: each selector key collapses to ONE winner per
 * property at index time, so an element costs O(its matched keys × their
 * properties), never O(rules).
 */

import type { FindingSet } from "./findings.js";

/** Resolved declarations: property → lower-cased value. */
type Decls = Map<string, string>;

interface Decl {
  value: string;
  important: boolean;
}

interface Winner extends Decl {
  rank: number;
  order: number;
}

/** Per selector key: property → winning declaration (same specificity, so importance then order). */
type KeyDecls = Map<string, Winner>;

export interface CssIndex {
  type: Map<string, KeyDecls>;
  cls: Map<string, KeyDecls>;
  id: Map<string, KeyDecls>;
  rules: number;
}

const SIMPLE_SELECTOR = /^(?:[a-z][a-z0-9-]*|\.[\w-]+|#[\w-]+)$/i;
const IMPORTANT = /!\s*important\s*$/i;

const TYPE_RANK = 0;
const CLASS_RANK = 1;
const ID_RANK = 2;
const INLINE_RANK = 3;

/** Remove `/* … *\/` comments with linear `indexOf` scans; an unclosed comment runs to the end. */
function stripCssComments(css: string): string {
  let open = css.indexOf("/*");
  if (open === -1) return css;
  let out = "";
  let last = 0;
  while (open !== -1) {
    out += css.slice(last, open);
    const close = css.indexOf("*/", open + 2);
    if (close === -1) return out;
    last = close + 2;
    open = css.indexOf("/*", last);
  }
  return out + css.slice(last);
}

function parseDeclList(style: string): Map<string, Decl> {
  const decls = new Map<string, Decl>();
  for (const part of stripCssComments(style).split(";")) {
    const colon = part.indexOf(":");
    if (colon <= 0) continue;
    const prop = part.slice(0, colon).trim().toLowerCase();
    const raw = part.slice(colon + 1).trim().toLowerCase();
    const important = IMPORTANT.test(raw);
    const value = important ? raw.replace(IMPORTANT, "").trim() : raw;
    const existing = decls.get(prop);
    // Within one block: an important declaration is not overridden by a later normal one.
    if (prop && (!existing || important || !existing.important)) decls.set(prop, { value, important });
  }
  return decls;
}

function values(decls: Map<string, Decl>): Decls {
  return new Map([...decls].map(([prop, d]) => [prop, d.value]));
}

/** Does `candidate` beat `current` in the cascade? importance → rank → order. */
function beats(candidate: Winner, current: Winner | undefined): boolean {
  if (!current) return true;
  if (candidate.important !== current.important) return candidate.important;
  if (candidate.rank !== current.rank) return candidate.rank > current.rank;
  return candidate.order >= current.order;
}

function addToKey(map: Map<string, KeyDecls>, key: string, rank: number, order: number, decls: Map<string, Decl>): void {
  let keyDecls = map.get(key);
  if (!keyDecls) {
    keyDecls = new Map();
    map.set(key, keyDecls);
  }
  for (const [prop, d] of decls) {
    const candidate = { ...d, rank, order };
    if (beats(candidate, keyDecls.get(prop))) keyDecls.set(prop, candidate);
  }
}

function indexRule(index: CssIndex, prelude: string, body: string, findings: FindingSet): void {
  const decls = parseDeclList(body);
  const hides = hidingReason(values(decls)) !== null;
  const order = index.rules++;
  for (const selector of prelude.split(",").map((s) => s.trim())) {
    if (!selector) continue;
    if (!SIMPLE_SELECTOR.test(selector)) {
      if (hides) findings.add("unresolved_css", "low", `${selector} {${body}}`);
      continue;
    }
    if (selector.startsWith(".")) addToKey(index.cls, selector.slice(1), CLASS_RANK, order, decls);
    else if (selector.startsWith("#")) addToKey(index.id, selector.slice(1), ID_RANK, order, decls);
    else addToKey(index.type, selector.toLowerCase(), TYPE_RANK, order, decls);
  }
}

/**
 * Walk the innermost `prelude { body }` blocks of a (comment-free) stylesheet
 * with linear `indexOf` scans. Descends into `@media`-style wrappers; skips
 * other at-rules.
 */
function forEachCssRule(css: string, visit: (prelude: string, body: string) => void): void {
  let start = 0;
  let close = -1;
  for (let open = css.indexOf("{"); open !== -1; open = css.indexOf("{", open + 1)) {
    if (close < open) close = css.indexOf("}", open + 1);
    if (close === -1) return;
    const nextOpen = css.indexOf("{", open + 1);
    if (nextOpen !== -1 && nextOpen < close) {
      start = open + 1; // wrapper block (e.g. @media): its rules follow
      continue;
    }
    // Drop anything before the last `;`/`}` (e.g. `@import …;`, a closed wrapper).
    const prelude = css.slice(start, open).split(/[;}]/).pop()?.trim() ?? "";
    if (prelude && !prelude.startsWith("@")) visit(prelude, css.slice(open + 1, close));
    start = close + 1;
  }
}

/** Index the text of real `<style>` elements (collected by the HTML parser, never by regex). */
export function buildCssIndex(stylesheets: readonly string[], findings: FindingSet): CssIndex {
  const index: CssIndex = { type: new Map(), cls: new Map(), id: new Map(), rules: 0 };
  for (const sheet of stylesheets) {
    forEachCssRule(stripCssComments(sheet), (prelude, body) => indexRule(index, prelude, body, findings));
  }
  return index;
}

/** Cascaded declarations for one element: stylesheet rules, then inline `style`. */
export function resolveDecls(name: string, attribs: Record<string, string>, css: CssIndex): Decls {
  const best = new Map<string, Winner>();
  const apply = (keyDecls: KeyDecls | undefined) => {
    for (const [prop, w] of keyDecls ?? []) if (beats(w, best.get(prop))) best.set(prop, w);
  };
  if (css.rules > 0) {
    apply(css.type.get(name));
    for (const cls of new Set((attribs.class ?? "").split(/\s+/))) if (cls) apply(css.cls.get(cls));
    if (attribs.id) apply(css.id.get(attribs.id));
  }
  if (attribs.style) {
    for (const [prop, d] of parseDeclList(attribs.style)) {
      const candidate = { ...d, rank: INLINE_RANK, order: Number.MAX_SAFE_INTEGER };
      if (beats(candidate, best.get(prop))) best.set(prop, candidate);
    }
  }
  return new Map([...best].map(([prop, w]) => [prop, w.value]));
}

const NAMED_COLORS: Record<string, string> = { white: "#ffffff", black: "#000000" };

function normalizeColor(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const v = raw.replace(/\s+/g, "");
  if (NAMED_COLORS[v]) return NAMED_COLORS[v];
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  const rgb = /^rgba?\((\d{1,3}),(\d{1,3}),(\d{1,3})(?:,[\d.]+%?)?\)$/.exec(v);
  if (rgb) {
    return `#${[rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
  }
  return v || undefined;
}

/** First colour-looking token of a `background` shorthand. */
function backgroundColor(decls: Decls): string | undefined {
  const explicit = decls.get("background-color");
  if (explicit) return normalizeColor(explicit);
  const shorthand = decls.get("background");
  if (!shorthand) return undefined;
  const token = /(#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b)/.exec(shorthand);
  return token ? normalizeColor(token[1]) : undefined;
}

function offscreenPx(value: string | undefined): boolean {
  if (!value) return false;
  const m = /^-(\d+(?:\.\d+)?)(px|em|rem)?$/.exec(value);
  if (!m) return false;
  const magnitude = Number(m[1]) * (m[2] === "em" || m[2] === "rem" ? 16 : 1);
  return magnitude >= 999;
}

/** The first hiding technique a declaration set uses, as a finding id, or null. */
export function hidingReason(decls: Decls): string | null {
  if (decls.size === 0) return null;
  if (decls.get("display") === "none") return "html-display-none";
  const visibility = decls.get("visibility");
  if (visibility === "hidden" || visibility === "collapse") return "html-visibility-hidden";
  const fontSize = decls.get("font-size");
  if (fontSize !== undefined && /^0+(?:\.0*)?(?:px|pt|em|rem|%|ex|ch|vw|vh)?$/.test(fontSize)) {
    return "html-font-size-0";
  }
  const opacity = decls.get("opacity");
  if (opacity !== undefined && /^(?:0+(?:\.0*)?|\.0+|0+%)$/.test(opacity)) return "html-opacity-0";
  const fg = normalizeColor(decls.get("color"));
  if (fg !== undefined && fg === backgroundColor(decls)) return "html-color-match";
  const position = decls.get("position");
  if (
    (position === "absolute" || position === "fixed") &&
    ["left", "top", "right", "bottom"].some((side) => offscreenPx(decls.get(side)))
  ) {
    return "html-offscreen";
  }
  return null;
}
