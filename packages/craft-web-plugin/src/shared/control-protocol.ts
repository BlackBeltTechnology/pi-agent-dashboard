/**
 * Wire vocabulary of live agent control, shared by the host (client), the router (server) and the
 * bridge tool: message types, claim statuses, error codes and the size/time bounds. Pure data.
 *
 * Flow (design D1): the bridge tool calls the server router over the request lane; the router
 * broadcasts a session-scoped `control-probe`; every open instance answers with a `control-claim`; the
 * router chooses one and broadcasts a `control-run` naming its `instanceId`; only the client holding that
 * id acts, and its `control-result` is accepted only from the socket that claimed it.
 *
 * See change: add-craft-live-control (D1–D7).
 */

/** Server → browsers (session-scoped broadcasts). */
export const CONTROL_PROBE = "craft-web/control-probe";
export const CONTROL_RUN = "craft-web/control-run";
/** Browser → server (tier `operate`: plugin message types are unlisted, fail-closed). */
export const CONTROL_CLAIM = "craft-web/control-claim";
export const CONTROL_RESULT = "craft-web/control-result";
/** Browser → server: an instance closed, so pinned follow-ups answer `not-open` at once. */
export const CONTROL_GONE = "craft-web/control-gone";
/** Bridge → server request type on the plugin request lane. */
export const CONTROL_REQUEST = "craft-web/control";

/** Why an instance does or does not take a request (design D2; the first failing rule wins). */
export type ClaimStatus = "eligible" | "wrong-session" | "unsupported" | "not-ready" | "not-visible";

/** Codes of a failed `craft_control` call (design D7). */
export type ControlErrorCode =
  | "not-open"
  | "ambiguous"
  | "not-visible"
  | "not-ready"
  | "unsupported"
  | "busy"
  | "timeout"
  | "denied"
  | "reply_too_large"
  | "request_too_large"
  | "rate_limited"
  | "app_error"
  | "disabled"
  | "unavailable"
  | "no_handler";

/** Codes a client or frame may answer with (the server passes only these through). */
export const CLIENT_ERROR_CODES: ReadonlySet<string> = new Set<ControlErrorCode>([
  "not-open",
  "not-visible",
  "not-ready",
  "unsupported",
  "busy",
  "timeout",
  "denied",
  "reply_too_large",
  "app_error",
]);

/** Methods the host forwards or answers; `engine.execute` is further limited by the per-app allowlist. */
export const HOST_METHODS = ["engine.execute", "engine.commands", "document.inspect", "ui.inspect", "ui.screenshot", "host.state"] as const;

/** `result` of a reply, serialized (UTF-8 bytes). */
export const REPLY_MAX_BYTES = 192 * 1024;
/** `error` text of a reply (UTF-8 bytes); longer is truncated. */
export const ERROR_MAX_BYTES = 2 * 1024;
/** `ui.screenshot` PNG: refused above this many pixels, by its header, before decoding. */
export const SCREENSHOT_MAX_PIXELS = 16_000_000;
/** The frame has this long to answer one request; a later answer is still accepted (see {@link LATE_BUSY_MS}). */
export const APP_TIMEOUT_MS = 10_000;
/** After a timeout the instance stays `busy` until a late result arrives, or this long. */
export const LATE_BUSY_MS = 30_000;
/** Router window to collect claims: closes this long after the first eligible claim … */
export const CLAIM_GRACE_MS = 300;
/** … or after this long when none arrives. */
export const CLAIM_WINDOW_MS = 2_000;
/** Hard server TTL of one request (inside the lane's 15 s). */
export const SERVER_TTL_MS = 13_000;
/** Several eligible instances: the most recently focused wins when it was focused within this long. */
export const FOCUS_RECENT_MS = 600_000;
/** Routed requests per session per window (`host.state` is exempt). */
export const RATE_LIMIT = 20;
export const RATE_WINDOW_MS = 10_000;
/** A device download whose save follows less than this long after trusted input needs no confirmation. */
export const DOWNLOAD_CONFIRM_MS = 2_000;

/** UTF-8 byte length of a string. */
const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

/** `JSON.stringify` length in UTF-8 bytes, or `null` when the value is not JSON-serialisable. */
export function jsonBytes(value: unknown): number | null {
  try {
    const s = JSON.stringify(value);
    return s === undefined ? 0 : utf8Bytes(s);
  } catch {
    return null;
  }
}

/** Truncate `text` to at most `maxBytes` UTF-8 bytes (never splits a code point). */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (utf8Bytes(text) <= maxBytes) return text;
  let out = "";
  let bytes = 0;
  for (const ch of text) {
    const n = utf8Bytes(ch);
    if (bytes + n > maxBytes) break;
    out += ch;
    bytes += n;
  }
  return out;
}

/** The three path forms the server sends and a client matches against (design D2). */
export interface ControlPathForms {
  path: string;
  realPath?: string;
  relPath?: string;
  caseInsensitive: boolean;
}

const nfc = (s: string): string => s.normalize("NFC");
const fold = (s: string, ci: boolean): string => (ci ? nfc(s).toLowerCase() : nfc(s));
const slashes = (s: string): string => s.replace(/\\/g, "/").replace(/\/+/g, "/");

/** Lexically normalise a `/`-separated path: collapse `.`/`..` segments, no trailing slash. */
function normalizePosix(p: string): string {
  const s = slashes(p);
  const drive = /^[A-Za-z]:(?=\/|$)/.exec(s)?.[0] ?? "";
  const abs = drive !== "" || s.startsWith("/");
  const out: string[] = [];
  for (const seg of s.slice(drive.length).split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return drive + (abs ? "/" : "") + out.join("/");
}

const isAbsolute = (p: string): boolean => /^([A-Za-z]:)?\//.test(slashes(p));

/**
 * Does an open tab (`cwd` + `tabPath`, as the tab holds them) name the requested file? True when its absolute
 * path equals `path` or `realPath`, or its cwd-relative path equals `relPath` (case-folded when the server says so).
 */
export function tabMatches(forms: ControlPathForms, cwd: string, tabPath: string): boolean {
  const ci = forms.caseInsensitive;
  const abs = normalizePosix(isAbsolute(tabPath) ? tabPath : `${cwd}/${tabPath}`);
  const wants = [forms.path, forms.realPath].filter((x): x is string => typeof x === "string").map((x) => fold(normalizePosix(x), ci));
  if (wants.includes(fold(abs, ci))) return true;
  if (forms.relPath !== undefined) {
    const root = normalizePosix(cwd);
    const rel = abs.startsWith(`${root}/`) ? abs.slice(root.length + 1) : isAbsolute(tabPath) ? null : normalizePosix(tabPath);
    if (rel !== null && fold(rel, ci) === fold(normalizePosix(forms.relPath), ci)) return true;
  }
  return false;
}
