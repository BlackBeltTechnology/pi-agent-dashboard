/**
 * Minimal ordered XML tree over fast-xml-parser (design D1). Entities are
 * never expanded by the parser (`processEntities: false`); only the five
 * predefined XML entities and numeric character references are decoded here,
 * which needs no DTD. DOCTYPE parts never reach this module (zip.ts rejects).
 */
import { XMLParser } from "fast-xml-parser";

export interface XNode {
  /** Qualified name as written (`p:sp`, `a:t`). */
  name: string;
  attrs: Record<string, string>;
  children: XNode[];
  /** Concatenated direct text content. */
  text: string;
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  processEntities: false,
  htmlEntities: false,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
});

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_m, ref: string) => {
    if (ref.startsWith("#x")) return String.fromCodePoint(Number.parseInt(ref.slice(2), 16));
    if (ref.startsWith("#")) return String.fromCodePoint(Number.parseInt(ref.slice(1), 10));
    return NAMED[ref];
  });
}

type Raw = Record<string, unknown>;

function convert(raw: Raw): XNode | null {
  const name = Object.keys(raw).find((k) => k !== ":@");
  if (!name || name === "#text") return null;
  const attrsRaw = (raw[":@"] ?? {}) as Record<string, unknown>;
  const attrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrsRaw)) attrs[k] = decodeEntities(String(v));
  const children: XNode[] = [];
  let text = "";
  for (const c of (raw[name] as Raw[]) ?? []) {
    if ("#text" in c) {
      text += decodeEntities(String(c["#text"]));
      continue;
    }
    const n = convert(c);
    if (n) children.push(n);
  }
  return { name, attrs, children, text };
}

/** Parse an XML part; returns the document element. */
export function parseXml(input: Uint8Array | string): XNode {
  const text = typeof input === "string" ? input : new TextDecoder().decode(input);
  const raw = parser.parse(text) as Raw[];
  for (const r of raw) {
    const n = convert(r);
    if (n) return n;
  }
  throw new Error("empty XML document");
}

/** First direct child named `name`. */
export function child(n: XNode | undefined, name: string): XNode | undefined {
  return n?.children.find((c) => c.name === name);
}

/** All direct children named `name`. */
export function kids(n: XNode | undefined, name: string): XNode[] {
  return n ? n.children.filter((c) => c.name === name) : [];
}

/** Walk a path of direct child names. */
export function path(n: XNode | undefined, ...names: string[]): XNode | undefined {
  let cur = n;
  for (const name of names) cur = child(cur, name);
  return cur;
}

/** First descendant (depth-first) named `name`. */
export function descendant(n: XNode | undefined, name: string): XNode | undefined {
  if (!n) return undefined;
  for (const c of n.children) {
    if (c.name === name) return c;
    const d = descendant(c, name);
    if (d) return d;
  }
  return undefined;
}

export function num(v: string | undefined, fallback = 0): number {
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
