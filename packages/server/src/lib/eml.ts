/**
 * EML (message/rfc822) parsing + body sanitization for the file-preview routes.
 *
 * `mailparser` decodes the MIME tree (charset / quoted-printable / RFC 2047);
 * `isomorphic-dompurify` (DOMPurify + jsdom) sanitizes the sender-controlled
 * HTML body. A small LRU (max 8, keyed path+mtime+size) memoizes the parse so
 * `/api/file/eml-attachment` reuses one `simpleParser` call. Remote resource
 * refs are neutralized by default (privacy: tracking-pixel block); the server
 * NEVER fetches remote URLs — the browser does, inside the opaque-origin iframe.
 * See change: add-eml-preview.
 */
import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import { type ParsedMail, simpleParser } from "mailparser";

// Lazy DOMPurify: `isomorphic-dompurify` constructs a jsdom window at import
// time. Loading it statically would run that at server boot, so a broken/torn
// jsdom install bricks startup. Deferring to first sanitize call scopes any such
// failure to a single EML preview request instead. See change: add-eml-preview.
type DomPurify = (typeof import("isomorphic-dompurify"))["default"];
let _purify: DomPurify | null = null;
async function getPurify(): Promise<DomPurify> {
  return (_purify ??= (await import("isomorphic-dompurify")).default);
}

/** Hard size cap enforced before read (design D6). */
export const EML_SIZE_CAP = 25 * 1024 * 1024;

/** Metadata for one attachment part — bytes are NOT included. */
export interface EmlAttachmentMeta {
  index: number;
  filename: string;
  mimeType: string;
  size: number;
  contentId: string | null;
  isInline: boolean;
}

export interface EmlHeaders {
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
}

export interface EmlParseResult {
  headers: EmlHeaders;
  html: string;
  text: string;
  attachments: EmlAttachmentMeta[];
  hasRemote: boolean;
}

// ── parse cache: small LRU, evicted on mtime/size change ───────────────────
const CACHE_MAX = 8;
interface CacheEntry {
  key: string;
  parsed: ParsedMail;
}
const parseCache: CacheEntry[] = [];

function cacheKey(absPath: string, stat: Stats): string {
  return `${absPath}|${stat.mtimeMs}|${stat.size}`;
}

/** Wrapper around `simpleParser` so tests can count invocations. */
export async function parseEmlBuffer(buf: Buffer): Promise<ParsedMail> {
  return simpleParser(buf);
}

/**
 * Load + parse an `.eml`, memoized by path+mtime+size. On a key miss the file is
 * read and parsed; the LRU keeps at most `CACHE_MAX` entries. A changed mtime or
 * size produces a new key, so the stale entry is never returned (and ages out).
 */
export async function loadParsedEml(absPath: string, stat: Stats): Promise<ParsedMail> {
  const key = cacheKey(absPath, stat);
  const hitIdx = parseCache.findIndex((e) => e.key === key);
  if (hitIdx >= 0) {
    const [hit] = parseCache.splice(hitIdx, 1);
    parseCache.unshift(hit);
    return hit.parsed;
  }
  const buf = await fs.readFile(absPath);
  const parsed = await parseEmlBuffer(buf);
  parseCache.unshift({ key, parsed });
  if (parseCache.length > CACHE_MAX) parseCache.length = CACHE_MAX;
  return parsed;
}

/** Test-only: drop all cached parses. */
export function clearEmlCache(): void {
  parseCache.length = 0;
}

function stripAngle(id: string | undefined): string | null {
  if (!id) return null;
  return id.replace(/^<|>$/g, "");
}

/**
 * A resource ref is "remote" when it would trigger a network fetch: absolute
 * http(s) or protocol-relative. `cid:` (attachment-backed) and `data:` (inline)
 * are never remote. Comma-separated values (e.g. `srcset`) are split so a leading
 * `cid:`/`data:` candidate cannot smuggle a trailing remote URL past the block.
 */
function isRemoteRef(value: string): boolean {
  return value
    .toLowerCase()
    .split(",")
    .some((part) => {
      const p = part.trim();
      return p.startsWith("http://") || p.startsWith("https://") || p.startsWith("//");
    });
}

const CSS_URL_RE = /url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi;
// Naked `@import "..."` (no url() wrapper) is a second remote-CSS load vector.
const CSS_IMPORT_RE = /@import\s+(['"])([^'"]+)\1/gi;

/** Neutralize remote `url(...)` + `@import` refs in CSS; leaves cid:/data: intact. */
function neutralizeCssUrls(
  css: string,
  allowRemote: boolean,
): { css: string; found: boolean } {
  let found = false;
  let out = css.replace(CSS_URL_RE, (match, _quote: string, ref: string) => {
    if (!isRemoteRef(ref)) return match;
    found = true;
    return allowRemote ? match : "url(about:blank)";
  });
  out = out.replace(CSS_IMPORT_RE, (match, quote: string, ref: string) => {
    if (!isRemoteRef(ref)) return match;
    found = true;
    return allowRemote ? match : `@import ${quote}about:blank${quote}`;
  });
  return { css: out, found };
}

const REF_ATTRS = ["src", "srcset", "background", "poster"] as const;

// Minimal structural view of the jsdom node DOMPurify returns with RETURN_DOM.
// The server tsconfig omits the `dom` lib, so we type only the members we use.
interface DomEl {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  querySelectorAll(selector: string): ArrayLike<DomEl>;
  textContent: string | null;
  innerHTML: string;
}

/**
 * Sanitize a sender HTML body: DOMPurify strips scripts / event handlers, then a
 * DOM pass neutralizes remote resource refs (attributes + CSS `url()` in `<style>`
 * and inline `style`) unless `allowRemote`. `cid:`/`data:` refs are preserved for
 * the client to resolve to `blob:` URLs. Returns the inner HTML + whether any
 * remote ref was seen (drives the "Load remote content" banner).
 */
export async function sanitizeBody(
  rawHtml: string,
  opts: { allowRemote: boolean },
): Promise<{ html: string; hasRemote: boolean }> {
  if (!rawHtml) return { html: "", hasRemote: false };
  const DOMPurify = await getPurify();
  const bodyEl = DOMPurify.sanitize(rawHtml, {
    RETURN_DOM: true,
    WHOLE_DOCUMENT: false,
    // FORCE_BODY keeps a leading `<style>` from being hoisted to <head> + dropped.
    FORCE_BODY: true,
    ADD_TAGS: ["style"],
    ADD_ATTR: ["target"],
  }) as unknown as DomEl;

  let hasRemote = false;
  const elements: DomEl[] = [bodyEl, ...Array.from(bodyEl.querySelectorAll("*"))];
  for (const el of elements) {
    for (const attr of REF_ATTRS) {
      const v = el.getAttribute?.(attr);
      if (v && isRemoteRef(v)) {
        hasRemote = true;
        if (!opts.allowRemote) {
          el.removeAttribute(attr);
          el.setAttribute(`data-blocked-${attr}`, v);
        }
      }
    }
    const style = el.getAttribute?.("style");
    if (style) {
      const { css, found } = neutralizeCssUrls(style, opts.allowRemote);
      if (found) {
        hasRemote = true;
        if (!opts.allowRemote) el.setAttribute("style", css);
      }
    }
  }
  for (const styleEl of Array.from(bodyEl.querySelectorAll("style"))) {
    const { css, found } = neutralizeCssUrls(styleEl.textContent || "", opts.allowRemote);
    if (found) {
      hasRemote = true;
      if (!opts.allowRemote) styleEl.textContent = css;
    }
  }
  return { html: bodyEl.innerHTML, hasRemote };
}

/**
 * Reverse mailparser's cid-image inlining: it rewrites `cid:<id>` in `<img src>`
 * to a `data:<mime>;base64,<bytes>` URI, which re-embeds the (potentially large)
 * attachment base64 in the body — exactly the payload bloat the design avoids.
 * Restore the `cid:` ref (matching the exact inlined data URI) so the body JSON
 * stays small and the client resolves it to a lazily-fetched `blob:` URL.
 */
function deinlineCidImages(
  html: string,
  attachments: ParsedMail["attachments"],
): string {
  let out = html;
  for (const a of attachments || []) {
    const cid = stripAngle(a.contentId);
    if (!cid || !a.content) continue;
    const dataUri = `data:${a.contentType || "application/octet-stream"};base64,${a.content.toString("base64")}`;
    out = out.split(dataUri).join(`cid:${cid}`);
  }
  return out;
}

/** Map a `mailparser` result into the metadata-only shape the client consumes. */
export async function toParseResult(
  parsed: ParsedMail,
  opts: { allowRemote: boolean },
): Promise<EmlParseResult> {
  const rawHtml = deinlineCidImages(parsed.html || "", parsed.attachments);
  const { html, hasRemote } = await sanitizeBody(rawHtml, opts);
  const attachments: EmlAttachmentMeta[] = (parsed.attachments || []).map((a, index) => ({
    index,
    filename: a.filename || `attachment-${index}`,
    mimeType: a.contentType || "application/octet-stream",
    size: a.size ?? a.content?.length ?? 0,
    contentId: stripAngle(a.contentId),
    isInline: Boolean(a.related) || a.contentDisposition === "inline",
  }));
  return {
    headers: {
      from: parsed.from?.text || "",
      to: Array.isArray(parsed.to)
        ? parsed.to.map((x) => x.text).join(", ")
        : parsed.to?.text || "",
      cc: Array.isArray(parsed.cc) ? parsed.cc.map((x) => x.text).join(", ") : parsed.cc?.text || "",
      subject: parsed.subject || "",
      date: parsed.date ? parsed.date.toISOString() : "",
    },
    html,
    text: parsed.text || "",
    attachments,
    hasRemote,
  };
}
