/**
 * Duplicate `pi_dash_*` cookie refusal (D10). A sibling subdomain (or a path-scoped planting) can toss a second
 * cookie with the same NAME as a dashboard credential; the browser then sends both and the server would read an
 * arbitrary one. The dashboard refuses every request (HTTP and WS upgrade) whose `Cookie` header carries any
 * `pi_dash_*` name more than once — by NAME only, never by value — and the 400 response expires that name at every
 * path that could have been planted, so the refusal self-heals.
 *
 *   host gate → duplicate-cookie gate (400, no CORS headers) → origin gates (403) → auth
 *
 * 400, not 401: a 401 sends the client into re-auth, which cannot clear a tossed cookie. Preview origins are served
 * by `previewApp` (own Fastify instance) and are exempt by construction.
 *
 * See change: serve-live-previews-on-capability-origin (D10).
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { getResolvedPreviewOrigins } from "../config-snapshot.js";
import { redactCapability } from "../live-server/capability-redact.js";
import { sanitizeHeaderForLog } from "./cors-origin.js";
import { wantsHtml } from "./host-gate.js";

/** Dashboard cookie namespace (literal, case-sensitive). Mirrors `live-server-proxy.ts`. */
const DASHBOARD_COOKIE_PREFIX = "pi_dash_";
/** Names echoed in a body or log are truncated to this many characters (Q28). */
const COOKIE_NAME_ECHO_MAX = 128;
/** Self-heal covers prefixes of the first N path segments. */
const EXPIRY_MAX_SEGMENTS = 16;
/** Hard cap on `Set-Cookie` expiry lines per refusal. */
const EXPIRY_MAX_LINES = 64;
/**
 * Hard cap on the total size of the expiry lines. A long request path puts that path into every line, and Node's
 * HTTP parser rejects a head over `http.maxHeaderSize` (16 KiB); half of it leaves room for the other headers.
 */
const EXPIRY_MAX_BYTES = 8192;
/** The paths the dashboard itself sets cookies at (token / local `/`, device `/api/`, oauth_state `/auth/`). */
const CANONICAL_COOKIE_PATHS = ["/", "/api/", "/auth/"] as const;
/** Refusal log: one line per name per window, ≤ this many names tracked (parity with the host gate). */
const LOG_WINDOW_MS = 60_000;
const LOG_MAX_NAMES = 256;

/** RFC 6265 cookie-name `token` characters. */
const TOKEN_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/** A request path we are willing to put in `Set-Cookie: …; Path=`. */
const SAFE_PATH = /^\/[\x21-\x7e]*$/;

export interface DuplicateCookie {
  name: string;
  count: number;
}

/**
 * The first `pi_dash_*` name (in header order) that appears more than once in a raw `Cookie` header, with its total
 * count. Parses the raw header — pairs split on `;`, name = text before the first `=` (or the whole pair), trimmed —
 * so quoting, empty pairs, valueless pairs and spacing never hide a duplicate. Never throws.
 */
export function findDuplicateDashboardCookie(cookieHeader: string | string[] | undefined): DuplicateCookie | null {
  if (cookieHeader === undefined) return null;
  const raw = Array.isArray(cookieHeader) ? cookieHeader.join("; ") : cookieHeader;
  if (typeof raw !== "string" || raw.length === 0 || !raw.includes(DASHBOARD_COOKIE_PREFIX)) return null;
  const counts = new Map<string, number>();
  let first: string | null = null;
  for (const pair of raw.split(";")) {
    const eq = pair.indexOf("=");
    const name = (eq === -1 ? pair : pair.slice(0, eq)).trim();
    if (!name.startsWith(DASHBOARD_COOKIE_PREFIX)) continue;
    const n = (counts.get(name) ?? 0) + 1;
    counts.set(name, n);
    if (n === 2 && first === null) first = name;
  }
  if (first === null) return null;
  return { name: first, count: counts.get(first) ?? 2 };
}

/** The path part of a request URL (no query, no fragment). */
function pathOf(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/**
 * Every `Path=` a browser could have stored a planted cookie at for this request: each `/`-boundary prefix (with and
 * without the trailing slash) of the first {@link EXPIRY_MAX_SEGMENTS} segments, the exact request path, and the
 * canonical dashboard paths. Cookie identity is (name, domain, exact path), so expiring at all of them clears it.
 */
export function expiryPaths(url: string): string[] {
  const path = pathOf(url);
  const out = new Set<string>(["/"]);
  const segments = path.split("/").filter((s) => s.length > 0);
  let acc = "";
  const prefixes = segments.slice(0, EXPIRY_MAX_SEGMENTS);
  prefixes.forEach((seg, i) => {
    acc = `${acc}/${seg}`;
    out.add(acc);
    // a proper prefix is also a directory path (`/api/`); the full path keeps only its exact form
    if (i < segments.length - 1) out.add(`${acc}/`);
  });
  // the exact request path, even beyond the segment cap (still one line)
  const exact = `/${segments.join("/")}`;
  out.add(exact);
  if (path.endsWith("/") && segments.length > 0) out.add(`${exact}/`);
  for (const p of CANONICAL_COOKIE_PATHS) out.add(p);
  return [...out].filter((p) => SAFE_PATH.test(p));
}

/** Ancestor domains (≥ 2 labels, strictly above the host) of a hostname `Host`; none for IPs / single labels. */
export function ancestorDomains(hostHeader: string | undefined): string[] {
  if (typeof hostHeader !== "string") return [];
  let h = hostHeader.trim().toLowerCase();
  if (!h || h.startsWith("[")) return [];
  const colon = h.indexOf(":");
  if (colon !== -1) h = h.slice(0, colon);
  if (h.endsWith(".")) h = h.slice(0, -1);
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) || /^\d+(\.\d+){3}$/.test(h)) return [];
  const labels = h.split(".");
  const out: string[] = [];
  for (let i = 1; i <= labels.length - 2; i++) out.push(labels.slice(i).join("."));
  return out;
}

/** Is tier 2 (wildcard preview origins) active right now? Only then can a sibling subdomain toss a parent-domain cookie. */
function tier2Active(): boolean {
  const r = getResolvedPreviewOrigins();
  return r.enabled && r.tiers.includes(2) && !!r.wildcard;
}

/**
 * Keep the expiry lines within {@link EXPIRY_MAX_BYTES}: the dashboard's own cookie paths first (that is where a
 * legitimate credential lives), then the rest in order, skipping any line that no longer fits. Order is preserved.
 */
function fitExpiryBudget(lines: string[]): string[] {
  if (lines.reduce((n, l) => n + l.length, 0) <= EXPIRY_MAX_BYTES) return lines;
  const isCanonical = (l: string): boolean => (CANONICAL_COOKIE_PATHS as readonly string[]).includes(/Path=([^;]+)/.exec(l)?.[1] ?? "");
  const byPriority = lines.map((l, i) => ({ l, i, canonical: isCanonical(l) })).sort((a, b) => Number(b.canonical) - Number(a.canonical) || a.i - b.i);
  const keep = new Set<number>();
  let used = 0;
  for (const { l, i } of byPriority) {
    if (used + l.length > EXPIRY_MAX_BYTES) continue;
    used += l.length;
    keep.add(i);
  }
  return lines.filter((_, i) => keep.has(i));
}

/** `Set-Cookie` lines that expire `name` at every candidate path (host-only first, then parent-domain variants). */
export function buildExpiryLines(name: string, url: string, hostHeader: string | undefined, withDomains: boolean): string[] {
  if (!TOKEN_NAME.test(name) || name.length > COOKIE_NAME_ECHO_MAX) return [];
  const paths = expiryPaths(url);
  const lines = paths.map((p) => `${name}=; Max-Age=0; Path=${p}`);
  if (withDomains) {
    for (const domain of ancestorDomains(hostHeader)) {
      for (const p of paths) lines.push(`${name}=; Max-Age=0; Path=${p}; Domain=${domain}`);
    }
  }
  return fitExpiryBudget(lines.slice(0, EXPIRY_MAX_LINES));
}

const truncate = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s);
const escapeHtml = (v: string): string =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The JSON refusal body. */
function duplicateCookieBody(name: string): { success: false; error: "duplicate_dashboard_cookie"; cookie: string } {
  return { success: false, error: "duplicate_dashboard_cookie", cookie: truncate(name, COOKIE_NAME_ECHO_MAX) };
}

/** Static page for navigations: no script, no asset reference; the cookie name is escaped. */
function renderDuplicateCookieHtml(name: string): string {
  const safe = escapeHtml(truncate(name, COOKIE_NAME_ECHO_MAX));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Duplicate dashboard cookie</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}main{max-width:34rem;padding:2.5rem 1.75rem}code{font-family:ui-monospace,Menlo,monospace;background:rgba(127,127,127,.16);padding:.1rem .35rem;border-radius:.25rem}</style>
</head>
<body>
<main>
<h1>Your browser holds two copies of a dashboard cookie</h1>
<p>The cookie <code>${safe}</code> was sent twice, so the dashboard cannot tell which one is yours. This response asked your browser to delete it; reload this page.</p>
<p>If this page appears again, clear this site's cookies and sign in again.</p>
</main>
</body>
</html>
`;
}

/** Rate-limited refusal log: ≤ 1 line per name per window, ≤ 256 names tracked (least-recently-logged evicted). */
export class DuplicateCookieLog {
  private readonly seen = new Map<string, number>();
  private readonly sink: (line: string) => void;
  private readonly now: () => number;
  constructor(sink: (line: string) => void = (l) => console.warn(l), now: () => number = Date.now) {
    this.sink = sink;
    this.now = now;
  }

  note(name: string, count: number, url: string): void {
    const key = truncate(name, COOKIE_NAME_ECHO_MAX);
    const t = this.now();
    const last = this.seen.get(key);
    if (last !== undefined && t - last < LOG_WINDOW_MS) return;
    this.seen.delete(key);
    this.seen.set(key, t);
    while (this.seen.size > LOG_MAX_NAMES) {
      const oldest = this.seen.keys().next().value;
      if (oldest === undefined) break;
      this.seen.delete(oldest);
    }
    const route = truncate(redactCapability(sanitizeHeaderForLog(pathOf(url), 120)), 120);
    this.sink(`[cookie-gate] refused duplicate cookie name=${sanitizeHeaderForLog(key, COOKIE_NAME_ECHO_MAX)} count=${count} route=${route}`);
  }
}

export interface DuplicateCookieGateOptions {
  log?: DuplicateCookieLog;
  /** Defaults to {@link tier2Active}; injectable for tests. */
  tier2?: () => boolean;
}

/** `onRequest` hook: refuse a request carrying a duplicated `pi_dash_*` cookie name with a self-healing 400. */
export function createDuplicateCookieGate(opts: DuplicateCookieGateOptions = {}) {
  const log = opts.log ?? defaultLog;
  const tier2 = opts.tier2 ?? tier2Active;
  return function duplicateCookieGate(req: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void): void {
    const dup = findDuplicateDashboardCookie(req.headers.cookie);
    if (!dup) return done();
    // A failing log sink must never change the refusal: the response is the security decision, the log is a courtesy.
    try {
      log.note(dup.name, dup.count, req.url);
    } catch {
      /* fall through: still refuse */
    }
    const lines = buildExpiryLines(dup.name, req.url, req.headers.host, tier2());
    if (lines.length > 0) reply.header("set-cookie", lines);
    reply.header("cache-control", "no-store");
    if (wantsHtml(req.headers.accept)) reply.code(400).type("text/html; charset=utf-8").send(renderDuplicateCookieHtml(dup.name));
    else reply.code(400).send(duplicateCookieBody(dup.name));
  };
}

/**
 * The same check for a WS upgrade (raw socket). Returns `true` when the upgrade was refused (the socket is written
 * to and destroyed); the caller returns before any ticket is consumed or any scope handler runs.
 */
export function refuseDuplicateCookieUpgrade(
  request: import("node:http").IncomingMessage,
  socket: import("node:stream").Duplex,
  opts: DuplicateCookieGateOptions = {},
): boolean {
  const dup = findDuplicateDashboardCookie(request.headers.cookie);
  if (!dup) return false;
  // Fail closed: whatever goes wrong while composing or writing the head (a throwing log sink, a dead socket), the
  // upgrade is refused and the socket destroyed — never left half-open, never an uncaught exception from `upgrade`.
  const url = request.url ?? "/";
  try {
    (opts.log ?? defaultLog).note(dup.name, dup.count, url);
  } catch {
    /* a failing log sink must not cost the client its self-healing head */
  }
  try {
    const lines = buildExpiryLines(dup.name, url, request.headers.host, (opts.tier2 ?? tier2Active)());
    const head = ["HTTP/1.1 400 Bad Request", "Connection: close", "Content-Length: 0", ...lines.map((l) => `Set-Cookie: ${l}`)];
    socket.write(`${head.join("\r\n")}\r\n\r\n`);
  } catch {
    /* socket already gone, or the head could not be composed */
  }
  socket.destroy();
  return true;
}

const defaultLog = new DuplicateCookieLog();
