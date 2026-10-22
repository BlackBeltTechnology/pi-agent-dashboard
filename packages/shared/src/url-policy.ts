/**
 * One navigation-target classifier for the dashboard client, plugins and the
 * Electron shell (change: harden-client-sinks, design D2).
 *
 * Decides NAVIGATION targets only (`<a href>`, `window.open`, `location.*`,
 * `openExternal`). Media sources and the markdown protocol set stay with
 * `safeUrlTransform` / `is-external-href.ts`.
 *
 * Pure (WHATWG `URL` only, no DOM) and never throws.
 */

export type UrlClass = "internal" | "loopback" | "external" | "mailto" | "blocked";

/** Leading/trailing C0 controls and space, trimmed before classification. */
const EDGE_WS = /^[\u0000-\u0020]+|[\u0000-\u0020]+$/g;
/**
 * Any C0 control, DEL, or backslash left after trimming. The URL parser
 * silently strips TAB/CR/LF and treats `\` as `/` for special schemes, so the
 * RAW string is checked before parsing.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const RAW_FORBIDDEN = /[\u0000-\u001f\u007f\\]/;
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

function parseOrigin(origin: string | null): string | null {
  if (origin === null) return null;
  try {
    const o = new URL(origin).origin;
    return o === "null" ? null : o;
  } catch {
    return null;
  }
}

/** Loopback decided on the parser-normalized hostname (`0x7f.0.0.1` → `127.0.0.1`). */
function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "localhost.") return true;
  if (h.endsWith(".localhost") || h.endsWith(".localhost.")) return true;
  if (h === "[::1]") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

function classifyHttp(url: URL): UrlClass {
  return isLoopbackHost(url.hostname) ? "loopback" : "external";
}

/**
 * Classify `raw` relative to the page `origin`. With `origin === null`
 * (callers with no page, e.g. the Electron main process) there is no
 * `internal` class and relative or scheme-relative input is `blocked`.
 */
export function classifyUrl(raw: unknown, origin: string | null): UrlClass {
  if (typeof raw !== "string") return "blocked";
  const s = raw.replace(EDGE_WS, "");
  if (s === "" || RAW_FORBIDDEN.test(s)) return "blocked";
  const pageOrigin = parseOrigin(origin);

  try {
    // Scheme-relative: never internal, even when the host matches the origin.
    if (s.startsWith("//")) {
      if (pageOrigin === null) return "blocked";
      const url = new URL(s, pageOrigin);
      return url.protocol === "http:" || url.protocol === "https:" ? classifyHttp(url) : "blocked";
    }

    if (!HAS_SCHEME.test(s)) {
      // Relative path/query/fragment.
      if (pageOrigin === null) return "blocked";
      const url = new URL(s, pageOrigin);
      return url.origin === pageOrigin && url.pathname.startsWith("/") && !url.pathname.startsWith("//")
        ? "internal"
        : "blocked";
    }

    const url = new URL(s);
    switch (url.protocol) {
      case "mailto:":
        return "mailto";
      case "http:":
      case "https:":
        if (pageOrigin !== null && url.origin === pageOrigin) return "internal";
        return classifyHttp(url);
      default:
        return "blocked";
    }
  } catch {
    return "blocked";
  }
}
