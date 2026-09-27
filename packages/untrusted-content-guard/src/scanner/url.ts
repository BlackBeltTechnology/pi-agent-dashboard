/**
 * URL layer (design D1 table, row `url`).
 *
 * - `data:` URLs → HIGH `data-url`; replaced by `[data-url removed: <mime>, <n> bytes]`
 *   when `replaceData` (strip/block). warn keeps them.
 * - Markdown `![](…)` / HTML `<img src>` images with a query string to a host
 *   not in `allowHosts` → LOW `tracking-image`, never removed.
 * - Mixed-script (Latin + Cyrillic/Greek) words in link text or domains → LOW
 *   `confusable`, never removed.
 */

import type { FindingSet } from "./findings.js";

const DATA_URL =
  /(?<![\w-])data:([a-z]+\/[a-z0-9.+-]+)?((?:;[a-z0-9-]+(?:=[^;,\s"')]*)?)*),([A-Za-z0-9+/=%._~-]*)/gi;
const MD_IMAGE = /!\[[^\]\n]{0,500}\]\(\s*<?(https?:\/\/[^\s)>]+)/gi;
const HTML_IMG = /<img\b[^>]*?\ssrc\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi;
const URL_HOST = /https?:\/\/([^\s/?#:"'<>)\]]+)/gi;
const MD_LINK_TEXT = /\[([^\]\n]{1,200})\]\(/g;

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

function checkImage(url: string, allowHosts: readonly string[], findings: FindingSet): void {
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

function checkConfusable(text: string, findings: FindingSet): void {
  for (const word of text.split(/[\s.\-_/]+/)) {
    if (word && isMixedScript(word)) findings.add("confusable", "low", word);
  }
}

export interface UrlLayerOptions {
  replaceData: boolean;
  allowHosts: readonly string[];
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
  const replaced = text.includes("data:") ? replaceDataUrls(text, findings) : text;

  if (text.includes("](") || /<img\b/i.test(text)) {
    for (const re of [MD_IMAGE, HTML_IMG]) eachMatch(re, text, (url) => checkImage(url, opts.allowHosts, findings));
  }

  if (/[^\x00-\x7f]/.test(text)) {
    for (const re of [URL_HOST, MD_LINK_TEXT]) eachMatch(re, text, (part) => checkConfusable(part, findings));
  }
  return opts.replaceData ? replaced : text;
}
