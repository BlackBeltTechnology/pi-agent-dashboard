/**
 * Map an active-change artifact path (`openspec/changes/<name>/<sub>`) to the
 * same artifact under the newest same-name archive entry. Pure.
 * See change: fix-archived-session-view-header-and-stale-artifact-tab (D2).
 */
import type { ArchiveEntry } from "@blackbelt-technology/pi-dashboard-shared/archive-types.js";
import { matchArchiveEntries } from "./resolve-attachment.js";

const ACTIVE_RE = /^openspec\/changes\/([^/]+)\/(.+)$/;

function parse(path: string): { name: string; sub: string } | null {
  const m = ACTIVE_RE.exec(path);
  if (!m || m[1] === "archive") return null;
  return { name: m[1], sub: m[2] };
}

/** Change name of an active-change artifact path, else null (archive/other/bare dir). */
export function activeChangeOfPath(path: string): string | null {
  return parse(path)?.name ?? null;
}

/** Archived path of `path` under the newest exactly-named archive entry, else null. */
export function archivedArtifactPath(path: string, entries: readonly ArchiveEntry[]): string | null {
  const p = parse(path);
  if (!p) return null;
  const [newest] = matchArchiveEntries(entries, p.name).sort((a, b) => b.date.localeCompare(a.date));
  return newest ? `openspec/changes/archive/${newest.name}/${p.sub}` : null;
}
