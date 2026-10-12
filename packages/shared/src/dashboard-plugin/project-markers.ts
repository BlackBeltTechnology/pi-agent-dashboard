/**
 * Project-type marker grammar — shared by the manifest validator (rejects bad
 * patterns at load) and the server's folder-project walker (matches segments).
 *
 * A marker is 1–3 `/`-joined segments; each is a literal name or a name with
 * `*` wildcards (`*` = zero or more non-`/` chars). The last segment must hold
 * at least one non-`*` char. No `.`/`..`/`.git`/`node_modules` segment, no `**`,
 * no `\`, no `?[]{}!`. Root-anchored by construction (no leading `/`).
 *
 * See change: add-project-scoped-apps.
 */

/** `type` / declared `id` shape. */
export const PROJECT_NAME_RE = /^[a-z][a-z0-9-]{0,63}$/;

export const MAX_PROJECT_TYPES = 8;
export const MAX_MARKERS_PER_TYPE = 16;
export const MAX_MARKER_SEGMENTS = 3;

/** Directory names the walker never visits (and a pattern may not name literally). */
export const EXCLUDED_WALK_NAMES: ReadonlySet<string> = new Set([".git", "node_modules"]);

const FORBIDDEN_CHARS = /[\\?[\]{}!]/;

/** Returns a human-readable violation, or `null` when `pattern` is valid. */
export function markerPatternError(pattern: unknown): string | null {
  if (typeof pattern !== "string" || pattern === "") return "must be a non-empty string";
  if (pattern.includes("**")) return 'must not contain "**"';
  if (FORBIDDEN_CHARS.test(pattern)) return "must not contain any of \\ ? [ ] { } !";
  const segments = pattern.split("/");
  if (segments.length > MAX_MARKER_SEGMENTS) return `must have at most ${MAX_MARKER_SEGMENTS} segments`;
  for (const seg of segments) {
    if (seg === "") return "must not start or end with / or contain empty segments";
    if (seg === "." || seg === "..") return 'must not contain a "." or ".." segment';
    if (EXCLUDED_WALK_NAMES.has(seg)) return `must not contain a "${seg}" segment`;
  }
  if (segments[segments.length - 1].replace(/\*/g, "") === "") {
    return "last segment must contain a character other than *";
  }
  return null;
}

/** Case-sensitive match of one name against one segment pattern (`*` = any run, incl. empty). */
export function matchSegment(segmentPattern: string, name: string): boolean {
  if (!segmentPattern.includes("*")) return segmentPattern === name;
  const parts = segmentPattern.split("*");
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (parts.length === 1) return segmentPattern === name;
  if (name.length < first.length + last.length) return false;
  if (!name.startsWith(first) || !name.endsWith(last)) return false;
  let pos = first.length;
  const end = name.length - last.length;
  for (let i = 1; i < parts.length - 1; i++) {
    const idx = name.indexOf(parts[i], pos);
    if (idx === -1 || idx + parts[i].length > end) return false;
    pos = idx + parts[i].length;
  }
  return true;
}
