/**
 * URL layer (design D1 table, row `url`).
 *
 * - `data:` URLs → HIGH `data-url`; replaced by `[data-url removed: <mime>, <n> bytes]`
 *   when `replaceData` (strip/block). warn keeps them.
 * - Markdown `![](…)` / HTML `<img src>` images with a query string to a host
 *   not in `allowHosts` → LOW `tracking-image`, never removed.
 * - Mixed-script (Latin + Cyrillic/Greek) words in link text (markdown or HTML
 *   `<a>`) or domains → LOW
 *   `confusable`, never removed.
 */

import type { FindingSet } from "./findings.js";

// Tag scans are bounded ({0,2000}) so unterminated `<img`/`<a` runs stay linear.
const DATA_URL =
  /(?<![\w-])data:([a-z]+\/[a-z0-9.+-]+)?((?:;[a-z0-9-]+(?:=[^;,\s"')]*)?)*),([A-Za-z0-9+/=%._~-]*)/gi;
const MD_IMAGE = /!\[[^\]\n]{0,500}\]\(\s*<?(https?:\/\/[^\s)>]+)/gi;
const HTML_IMG = /<img\b[^>]{0,2000}?\ssrc\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi;
const URL_HOST = /https?:\/\/([^\s/?#:"'<>)\]]+)/gi;
const MD_LINK_TEXT = /\[([^\]\n]{1,200})\]\(/g;
const HTML_LINK_TEXT = /<a\b[^>]{0,2000}>([^<]{1,200})<\/a\s*>/gi;

const LATIN = /\p{Script=Latin}/u;
const CONFUSABLE_SCRIPT = /[\p{Script=Cyrillic}\p{Script=Greek}]/u;

function dataBytes(params: string, payload: string): number {
  if (/;base64/i.test(params)) {
    const clean = payload.replace(/[^A-Za-z0-9+/=]/g, "");
    const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
  }
  // Percent-encoded payload: each %XX is one byte.
  return payload.replace(/%[0-9a-f]{2}/gi, "_").length;
}

function hostAllowed(host: string, allowHosts: readonly string[]): boolean {
  const h = host.toLowerCase();
  return allowHosts.some((a) => {
    const allowed = a.toLowerCase();
    return h === allowed || h.endsWith(`.${allowed}`);
  });
}

/** Report a query-string image to a non-allowlisted host (LOW `tracking-image`). */
export function checkImage(url: string, allowHosts: readonly string[], findings: FindingSet): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.search.length > 1 && !hostAllowed(parsed.hostname, allowHosts)) {
    findings.add("tracking-image", "low", url);
  }
}

function isMixedScript(word: string): boolean {
  return LATIN.test(word) && CONFUSABLE_SCRIPT.test(word);
}

/** Report mixed-script words in a domain or link text (LOW `confusable`). */
export function checkConfusable(text: string, findings: FindingSet): void {
  for (const word of text.split(/[\s.\-_/]+/)) {
    if (word && isMixedScript(word)) findings.add("confusable", "low", word);
  }
}

export interface UrlLayerOptions {
  replaceData: boolean;
  allowHosts: readonly string[];
}

const HOST_OF = /^\s*https?:\/\/([^\s/?#:"'<>)\]]+)/i;
const DATA_VALUE = /^\s*data:([a-z]+\/[a-z0-9.+-]+)?((?:;[a-z0-9-]+(?:=[^;,\s"')]*)?)*),(.*)$/is;

/** Hostname of an absolute http(s) URL, as written (never punycoded), or undefined. */
export function hostOf(url: string): string | undefined {
  return HOST_OF.exec(url)?.[1];
}

/** Placeholder for an attribute value that IS a `data:` URL, or null. */
export function dataUrlPlaceholder(value: string): string | null {
  // Canonicalise like the URL parser: drop ASCII tab/LF/CR anywhere, leading C0/space.
  const m = DATA_VALUE.exec(value.replace(/[\t\n\r]/g, "").replace(/^[\x00-\x20]+/, ""));
  if (!m) return null;
  return `[data-url removed: ${(m[1] ?? "text/plain").toLowerCase()}, ${dataBytes(m[2] as string, (m[3] as string).trim())} bytes]`;
}

function replaceDataUrls(text: string, findings: FindingSet): string {
  let count = 0;
  let first = "";
  const replaced = text.replace(DATA_URL, (match, mime: string | undefined, params: string, payload: string) => {
    if (count++ === 0) first = match.slice(0, 60);
    return `[data-url removed: ${(mime ?? "text/plain").toLowerCase()}, ${dataBytes(params, payload)} bytes]`;
  });
  if (count > 0) findings.add("data-url", "high", first, count);
  return replaced;
}

function eachMatch(re: RegExp, text: string, fn: (group: string) => void): void {
  re.lastIndex = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) fn(m[1] as string);
}

export function urlLayer(text: string, findings: FindingSet, opts: UrlLayerOptions): string {
  // Schemes are case-insensitive: `DATA:` must not slip past the pre-check.
  const replaced = /data:/i.test(text) ? replaceDataUrls(text, findings) : text;

  if (text.includes("](") || /<img\b/i.test(text)) {
    for (const re of [MD_IMAGE, HTML_IMG]) eachMatch(re, text, (url) => checkImage(url, opts.allowHosts, findings));
  }

  if (/[^\x00-\x7f]/.test(text)) {
    for (const re of [URL_HOST, MD_LINK_TEXT, HTML_LINK_TEXT]) eachMatch(re, text, (part) => checkConfusable(part, findings));
  }
  return opts.replaceData ? replaced : text;
}
