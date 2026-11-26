/**
 * Pure raw-path parse of the tier-5 `/preview/<pid>/…` namespace. A leaf module (no store imports) so the guard,
 * the capability hook and the proxy can all use it without an import cycle.
 *
 * See change: serve-live-previews-on-capability-origin (D8).
 */

/** A pid is 16 random bytes, base64url → exactly 22 characters. */
export const PID_SHAPE = /^[A-Za-z0-9_-]{22}$/;

/** The raw-path parse of `/preview/<pid>[/rest][?query]`; `null` for anything not exactly that shape. */
export interface PreviewPath {
  pid: string;
  /** `/preview/<pid>` */
  prefix: string;
  /** Everything after the prefix, RAW (`""`, `/x`, `?q=1`): the upstream receives `<prefix><rest>` unchanged. */
  rest: string;
}

/**
 * Parse a raw request URL under `/preview/`. Refuses (null) a dot-segment, a percent-encoded `/`, `~`, `.` or `\`
 * (hex case-insensitive), a raw `\` and `%00`: those never reach the upstream. `//` and `%252e` are forwarded raw.
 */
export function parsePreviewPath(url: string | undefined): PreviewPath | null {
  if (typeof url !== "string" || !url.startsWith("/preview/")) return null;
  let end = url.length;
  for (const sep of ["?", "#"] as const) {
    const i = url.indexOf(sep);
    if (i >= 0 && i < end) end = i;
  }
  const pathname = url.slice(0, end);
  if (/%2f|%7e|%2e|%5c|%00/i.test(pathname) || pathname.includes("\\") || pathname.includes("\0")) return null;
  const segments = pathname.split("/");
  // ["", "preview", pid, ...rest]
  if (segments.length < 3 || segments[0] !== "" || segments[1] !== "preview") return null;
  if (!PID_SHAPE.test(segments[2])) return null;
  if (segments.some((s) => s === "." || s === "..")) return null;
  const prefix = `/preview/${segments[2]}`;
  return { pid: segments[2], prefix, rest: url.slice(prefix.length) };
}
