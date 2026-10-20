/**
 * Live-server-preview target validation — the SSRF boundary.
 *
 * Pure, browser-safe (no `node:*`) so the client pre-validates and the server
 * enforces with the SAME rule. Only loopback hosts are embeddable; everything
 * else (cloud metadata `169.254.169.254`, private LAN, public hosts) is
 * rejected to prevent the dashboard from being turned into an SSRF proxy.
 *
 * See change: improve-content-editor (live-server-preview §6).
 */

/** Hosts that resolve to the local machine only. */
export const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
]);

/**
 * True only for an `http(s)://{localhost,127.0.0.1,::1}[:port]/…` URL.
 *
 * A UX router, NOT a trust boundary — it decides whether a click opens the
 * internal live-server split viewer vs. a system-browser tab. The server
 * `validateLiveTarget` remains the real SSRF gate. Credential-in-host
 * (`http://localhost@evil.com/`) parses to `hostname = "evil.com"` → false;
 * `0.0.0.0` / IPv4-mapped IPv6 are absent from `LOOPBACK_HOSTS` → false.
 */
export function isLoopbackUrl(href: string): boolean {
  try {
    const u = new URL(href);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    // IPv6 hostnames carry brackets (`[::1]`); strip so they match LOOPBACK_HOSTS.
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return LOOPBACK_HOSTS.has(host);
  } catch {
    return false;
  }
}

export interface LiveServerTargetInput {
  host: string;
  port: number;
  label?: string;
}

/**
 * How a port target came to exist. `user` = added by the operator (persisted);
 * `preset` = agent-declared, in-memory only; `legacy` = persisted before the
 * field existed (origin unknown). See change: improve-canvas-html-and-url-ux.
 */
export type LiveTargetAddedBy = "user" | "preset" | "legacy";

export interface LiveServerTarget {
  id: string;
  label: string;
  host: string;
  port: number;
  /** Optional on the wire: a missing value reads as `legacy`. */
  addedBy?: LiveTargetAddedBy;
}

/** An in-memory static-file target: a document root served under `/live/<id>/`. */
export interface StaticTarget {
  id: string;
  cwd: string;
  root: string;
}

export type LiveTargetValidation =
  | { ok: true; host: string; port: number; label: string }
  | { ok: false; error: string };

/** Normalise + validate a live-server target. Loopback-only; port 1..65535. */
export function validateLiveTarget(input: unknown): LiveTargetValidation {
  // Robust to non-object input (e.g. a `null`/primitive entry in a hand-edited
  // persisted allowlist) — never throw during validation.
  if (!input || typeof input !== "object") {
    return { ok: false, error: "target must be an object" };
  }
  const { host: rawHost, port: rawPort, label: rawLabelIn } = input as {
    host?: unknown;
    port?: unknown;
    label?: unknown;
  };
  const host = typeof rawHost === "string" ? rawHost.trim().toLowerCase() : "";
  if (!host) return { ok: false, error: "host is required" };
  if (!LOOPBACK_HOSTS.has(host)) {
    return { ok: false, error: "only loopback hosts (localhost, 127.0.0.1, ::1) are allowed" };
  }
  const port = typeof rawPort === "number" ? rawPort : Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: "port must be an integer in 1..65535" };
  }
  const rawLabel = typeof rawLabelIn === "string" ? rawLabelIn.trim() : "";
  const label = rawLabel || `${host}:${port}`;
  return { ok: true, host, port, label };
}

/** The proxied path a validated target is served under on the main origin. */
export function liveServerPath(id: string): string {
  return `/live/${id}/`;
}

// ---------------------------------------------------------------------------
// Static-target helpers (pure, browser-safe).
// See change: improve-canvas-html-and-url-ux (design D2, D9).
// ---------------------------------------------------------------------------

/** Web asset extensions a static target may serve. No source maps, no `.txt`. */
export const STATIC_WEB_EXTENSIONS: ReadonlySet<string> = new Set([
  "html", "htm", "css", "js", "mjs", "json", "svg", "png", "jpg", "jpeg",
  "gif", "webp", "avif", "ico", "woff", "woff2", "ttf", "otf", "mp4", "webm",
  "ogg", "mp3", "wav", "m4a",
]);

/** True when `name`'s extension is on the static web-asset allowlist. */
export function isStaticWebAsset(name: string): boolean {
  const i = name.lastIndexOf(".");
  if (i < 0) return false;
  return STATIC_WEB_EXTENSIONS.has(name.slice(i + 1).toLowerCase());
}

/** Secret-like base names a static target never serves (case-insensitive). */
const CREDENTIAL_NAME_RES: readonly RegExp[] = [
  /\.(pem|key|p12|pfx|jks|keystore)$/,
  /secret/,
  /credential/,
  /token/,
  /password/,
  /passwd/,
  /private/,
  /^id_rsa/,
  /^auth\.json$/,
  /^service-account.*\.json$/,
  /\.tfstate/,
];

/** True when a single file/dir name looks like a credential (design D2 list). */
export function isCredentialName(name: string): boolean {
  const n = name.toLowerCase();
  return CREDENTIAL_NAME_RES.some((re) => re.test(n));
}

const posixDir = (p: string): string => {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
};

/** True when `p` is `base` or lies beneath it (component-wise, POSIX paths). */
function isWithin(p: string, base: string): boolean {
  if (base === "/") return true;
  return p === base || p.startsWith(`${base}/`);
}

/**
 * Document root of a static target (design D2).
 *
 * Inside `cwd`: nearest ancestor (inclusive) of the file's directory that holds
 * a marker (`index.html` / `package.json`), searched no higher than `cwd`;
 * none found → the file's own directory (never the whole cwd). Outside `cwd`
 * (a granted file) → the file's own directory.
 *
 * `hasMarker(dir)` answers whether `dir` contains a marker file. POSIX paths.
 */
export function resolveStaticRoot(
  cwd: string,
  file: string,
  hasMarker: (dir: string) => boolean,
): string {
  const fileDir = posixDir(file);
  let base = cwd;
  while (base.length > 1 && base.endsWith("/")) base = base.slice(0, -1);
  if (!isWithin(file, base)) return fileDir;
  let dir = fileDir;
  for (;;) {
    if (hasMarker(dir)) return dir;
    if (dir === base || dir === "/") break;
    dir = posixDir(dir);
    if (!isWithin(dir, base)) break;
  }
  return fileDir;
}

export type AddressPathResult = { ok: true; path: string } | { ok: false; error: string };

/**
 * Validate + encode an address-bar path (design D9). Empty / `/` → root (`""`).
 * One trailing `/` is allowed. Empty, `.`, `..`, backslash and control-char
 * segments are rejected; each segment is percent-encoded. `?query` / `#frag`
 * are preserved verbatim after the path. The result has no leading slash.
 */
export function validateAddressPath(input: string): AddressPathResult {
  let rest = typeof input === "string" ? input.trim() : "";
  let suffix = "";
  const cut = rest.search(/[?#]/);
  if (cut >= 0) {
    suffix = rest.slice(cut);
    rest = rest.slice(0, cut);
  }
  if (rest === "" || rest === "/") return { ok: true, path: suffix };
  if (rest.startsWith("/")) rest = rest.slice(1);
  const trailing = rest.endsWith("/");
  if (trailing) rest = rest.slice(0, -1);
  const out: string[] = [];
  for (const seg of rest.split("/")) {
    if (seg === "" || seg === "." || seg === "..") {
      return { ok: false, error: "invalid path segment" };
    }
    // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control chars is the point
    if (seg.includes("\\") || /[\u0000-\u001f\u007f]/.test(seg)) {
      return { ok: false, error: "invalid path segment" };
    }
    // A pre-encoded segment is decoded once and re-checked, then re-encoded.
    let decoded: string;
    try {
      decoded = decodeURIComponent(seg);
    } catch {
      return { ok: false, error: "invalid path encoding" };
    }
    // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control chars is the point
    if (decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\") || /[\u0000-\u001f\u007f]/.test(decoded)) {
      return { ok: false, error: "invalid path segment" };
    }
    out.push(encodeURIComponent(decoded));
  }
  return { ok: true, path: out.join("/") + (trailing ? "/" : "") + suffix };
}
