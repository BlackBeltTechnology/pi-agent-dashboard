/**
 * Opaque-frame and base-path helpers shared by the shell, the pane runtime and the fixture layer.
 *
 * Tier 5 (`/preview/<pid>/`) frames the site in a sandbox WITHOUT `allow-same-origin`: `window.origin` is the string
 * `"null"`, `postMessage(…, location.origin)` throws and storage is unavailable. Tiers 1-4 frame a real origin and need none
 * of it. Messaging rule (both directions): post to ONE known window only (`parent` / `frame.contentWindow`), with `"*"` only
 * while opaque, and accept a message only from that window (`e.source`). Payloads carry no decisions, fixtures or URLs.
 * See change: serve-live-previews-on-capability-origin (D11 (3), (5), (9), (10)).
 */

/** The Vite `base` this document is served under (always ends with `/`). */
export const BASE: string = import.meta.env?.BASE_URL ?? "/";

/**
 * Is this document in an opaque origin (a sandboxed frame without `allow-same-origin`)? `window.origin` is the DOCUMENT's
 * origin ("null" when sandboxed); `location.origin` is the URL's origin and stays the real one even in such a frame, so it
 * only says "null" for URLs that have none (kept as the fallback when a host exposes no `window.origin`).
 */
export const isOpaque = (): boolean => (globalThis as { origin?: string }).origin === "null" || location.origin === "null";

/** `targetOrigin` for a `postMessage` to a known window: `"*"` only while opaque, the real origin otherwise. */
export const postTarget = (): string => (isOpaque() ? "*" : location.origin);

/** Origin check for an INBOUND message; opaque frames carry the origin `"null"` and rely on the `e.source` check instead. */
export const originOk = (e: MessageEvent): boolean => (isOpaque() ? e.origin === "null" : e.origin === location.origin);

/** Is `source` the window of one of this document's child frames? */
export const fromChildFrame = (source: MessageEventSource | null): boolean =>
  source !== null && Array.from(document.querySelectorAll("iframe")).some((f) => f.contentWindow === source);

type Kind = "local" | "session";
const area = (kind: Kind): Storage | null => {
  try {
    return kind === "local" ? localStorage : sessionStorage;
  } catch {
    return null; // a SecurityError in an opaque frame
  }
};
/** Storage read that never throws (`null` when unavailable). */
export const readStore = (kind: Kind, key: string): string | null => {
  try {
    return area(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
};
/** Storage write that never throws. */
export const writeStore = (kind: Kind, key: string, value: string): void => {
  try {
    area(kind)?.setItem(key, value);
  } catch {
    /* unavailable / quota */
  }
};

/** Strip `base` from a path ONLY when the path is under it (`/some/prefix/x` → `/x`); anything else is returned as is. */
export function stripBase(pathname: string, base: string = BASE): string {
  return base !== "/" && pathname.startsWith(base) ? `/${pathname.slice(base.length)}` : pathname;
}
