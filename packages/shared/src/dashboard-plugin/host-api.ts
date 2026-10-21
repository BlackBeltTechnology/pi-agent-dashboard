/**
 * Plugin host API version contract (design D7).
 *
 * `PLUGIN_HOST_API_VERSION` is the semver of the public runtime surface
 * (`dashboard-plugin-runtime/src/public.ts` + `./sdk`), NOT the package release
 * version. A plugin manifest declares the range it was built against in
 * `hostApi`; discovery evaluates it. Written in-house: caret + exact only, no
 * semver dependency (shared stays dependency-free).
 *
 * See change: decouple-plugins-from-core.
 */

/** Current host API version. Bump per the snapshot rules in `scripts/host-api-surface.mjs`. */
export const PLUGIN_HOST_API_VERSION = "1.0.0";

/** A manifest `hostApi` range: `^MAJOR.MINOR[.PATCH]` or an exact `MAJOR.MINOR.PATCH`. */
export type HostApiRange = string;

const NUM = "(0|[1-9]\\d*)";
const VERSION_RE = new RegExp(`^${NUM}\\.${NUM}\\.${NUM}$`);
const CARET_RE = new RegExp(`^\\^${NUM}\\.${NUM}(?:\\.${NUM})?$`);

type Triple = readonly [number, number, number];

function parseVersion(version: string): Triple | null {
  const m = VERSION_RE.exec(version);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True when `range` is syntactically valid (caret `^MAJOR.MINOR[.PATCH]` or exact `MAJOR.MINOR.PATCH`). */
export function isValidHostApiRange(range: unknown): range is HostApiRange {
  return typeof range === "string" && (CARET_RE.test(range) || VERSION_RE.test(range));
}

function compare(a: Triple, b: Triple): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * Does `version` (`MAJOR.MINOR.PATCH`) satisfy `range`? Caret follows semver:
 * `^1.2` = `>=1.2.0 <2.0.0`, `^0.9.0` = `>=0.9.0 <0.10.0`, `^0.0.3` = exactly `0.0.3`.
 * An exact range matches only that version. Invalid input never satisfies.
 */
export function satisfiesHostApiRange(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  const exact = parseVersion(range);
  if (exact) return compare(v, exact) === 0;
  const m = CARET_RE.exec(range);
  if (!m) return false;
  const low: Triple = [Number(m[1]), Number(m[2]), m[3] === undefined ? 0 : Number(m[3])];
  if (compare(v, low) < 0) return false;
  if (low[0] > 0) return v[0] === low[0];
  if (low[1] > 0 || m[3] === undefined) return v[0] === 0 && v[1] === low[1];
  return v[0] === 0 && v[1] === 0 && v[2] === low[2];
}

/** `satisfiesHostApiRange` bound to {@link PLUGIN_HOST_API_VERSION} — the HOST's version, never a bundled copy's. */
export function satisfiesHostApi(range: string): boolean {
  return satisfiesHostApiRange(PLUGIN_HOST_API_VERSION, range);
}
