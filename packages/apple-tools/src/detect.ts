/**
 * Pure, injectable environment probes for the iMCP provisioning traversal.
 *
 * Every probe is a plain function over injected inputs so the whole installer
 * suite runs deterministically on Linux CI — no probe touches a real
 * `/Applications` path, spawns a real `sw_vers`, or invokes a real `brew`.
 *
 * See change: add-apple-tools-imcp-plugin.
 */

/** Minimum supported macOS version (inclusive floor). */
export const MIN_MACOS = "15.3";

/** Canonical, ordered candidate locations for the iMCP server binary. */
export const IMCP_RELATIVE = "iMCP.app/Contents/MacOS/imcp-server";

/** iMCP direct-download page, surfaced when no install method is available. */
export const IMCP_DOWNLOAD_URL = "https://github.com/mattt/iMCP/releases/latest";

/** Homebrew cask reference for iMCP. */
export const IMCP_BREW_CASK = "mattt/tap/iMCP";

/** Parse a dotted version string into numeric components; null if unparseable. */
export function parseVersion(raw: string | null | undefined): number[] | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parts = trimmed.split(".");
  const nums: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    nums.push(Number(p));
  }
  return nums.length > 0 ? nums : null;
}

/**
 * Numeric (not lexical) version compare. Returns <0, 0, or >0.
 * Guards against the `"15.10" < "15.3"` string-compare bug.
 */
export function compareVersions(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/** True when `version` (e.g. "15.10") is >= the inclusive floor `min`. */
export function meetsMinimum(version: string, min: string = MIN_MACOS): boolean {
  const v = parseVersion(version);
  const m = parseVersion(min);
  if (!v || !m) return false;
  return compareVersions(v, m) >= 0;
}

/**
 * Resolve the ordered candidate list for the imcp-server binary.
 *  1. an explicit, existing override (a preference that only wins when real),
 *  2. `/Applications/iMCP.app/...`,
 *  3. `~/Applications/iMCP.app/...`.
 * A non-existent override does NOT veto the candidate list (E13).
 */
export function candidatePaths(homedir: string, override?: string): string[] {
  const list: string[] = [];
  if (override && override.trim() !== "") list.push(override);
  list.push(`/Applications/${IMCP_RELATIVE}`);
  list.push(`${homedir}/Applications/${IMCP_RELATIVE}`);
  return list;
}

/**
 * Discover imcp-server against the candidate list. When an override is set and
 * EXISTS, it wins and the rest of the list is not consulted (E12). When the
 * override is set but absent, discovery falls through to the standard
 * candidates (E13).
 */
export function discoverServer(
  homedir: string,
  pathExists: (p: string) => boolean,
  override?: string,
): string | null {
  if (override && override.trim() !== "" && pathExists(override)) return override;
  for (const p of [`/Applications/${IMCP_RELATIVE}`, `${homedir}/Applications/${IMCP_RELATIVE}`]) {
    if (pathExists(p)) return p;
  }
  return null;
}
