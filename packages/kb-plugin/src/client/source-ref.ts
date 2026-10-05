/**
 * Pure source-ref helpers for the KB settings source editor.
 *
 * No runtime import from `@blackbelt-technology/pi-dashboard-kb`: that package
 * is server-only (`node:sqlite`, `node:child_process`). Path math uses the
 * isomorphic shared helpers, which the server's `outside` label also uses, so
 * the two surfaces cannot drift.
 *
 * See change: improve-kb-settings-sources-and-search (design D2, D3).
 */
import {
  isAbsolutePath,
  isOutside,
  relativePath,
} from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";

export { isOutside };

/**
 * Map a picked absolute folder to the ref stored in the config: relative to
 * `cwd` when inside (`.` for cwd itself), absolute with `outside:true` when not.
 */
export function toSourceRef(cwd: string, picked: string): { ref: string; outside: boolean } {
  if (!isAbsolutePath(picked) || !isAbsolutePath(cwd)) return { ref: picked, outside: false };
  if (isOutside(cwd, picked)) return { ref: picked, outside: true };
  return { ref: relativePath(cwd, picked), outside: false };
}

/** Hosts whose bare repo URL must be a git clone, not an https file fetch. */
const GIT_HOST = /^(https:\/\/(github|gitlab)\.com\/|git@|git:)/;

/** True when the ref should auto-select the Git kind. */
export function detectGitRef(ref: string): boolean {
  return GIT_HOST.test(ref.trim());
}

/**
 * True when the engine's `classifyRef` would NOT treat the ref as a filesystem
 * path (any `scheme://`, `git@`, `git:`, `npm:`). Folder mode refuses these so
 * a remote ref is never saved as a local path.
 */
export function looksLikeRemoteRef(ref: string): boolean {
  const r = ref.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(r) || r.startsWith("git@") || r.startsWith("git:") || r.startsWith("npm:");
}

export type SourceUiKind = "filesystem" | "git" | "https";

/** Kinds that need trust before the server will fetch them. */
export const isRemoteKind = (kind: string | undefined): boolean => kind === "git" || kind === "https" || kind === "npm";

/** Why a candidate source is refused (maps to a hint string), or null when acceptable. */
export type SourceRefusal = "remote-in-folder" | "npm" | "https-only" | "duplicate";

/** Pure validation for the add row: Folder refuses remote-shaped refs; URL needs https://; one source per ref. */
export function refuseSource(ref: string, kind: SourceUiKind, existingRefs: string[]): SourceRefusal | null {
  if (kind === "filesystem" && looksLikeRemoteRef(ref)) return ref.startsWith("npm:") ? "npm" : "remote-in-folder";
  if (kind === "https" && !ref.startsWith("https://")) return "https-only";
  return existingRefs.includes(ref) ? "duplicate" : null;
}
