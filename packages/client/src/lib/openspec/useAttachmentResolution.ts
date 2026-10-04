/**
 * Hooks wiring `resolveAttachment` + the shared archive cache into React.
 * See change: resolve-archived-attached-proposal (D1, D4).
 */
import type { ArchiveEntry } from "@blackbelt-technology/pi-dashboard-shared/archive-types.js";
import type { DashboardSession, OpenSpecChange, OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { type ArchiveCacheState, activeSignature, getArchiveCacheVersion, getArchiveState, requestArchive, subscribeArchiveCache } from "./archive-cache.js";
import { useOpenSpecMap } from "./OpenSpecMapContext.js";
import { type AttachmentResolution, resolveAttachment } from "./resolve-attachment.js";

/** Active-set signature for a folder, or null while its data is not authoritative. */
function sigOf(data: OpenSpecData | undefined): string | null {
  if (!data?.initialized) return null;
  return activeSignature(data.changes.map((c) => c.name));
}

function useArchiveVersion(): void {
  useSyncExternalStore(subscribeArchiveCache, getArchiveCacheVersion, getArchiveCacheVersion);
}

const IDLE_STATE: ArchiveCacheState = { status: "idle", entries: [] };

/** Lazy archive read for one folder; `cwd = null` reads nothing. */
export function useArchiveEntries(cwd: string | null, mapOverride?: ReadonlyMap<string, OpenSpecData>): ArchiveCacheState {
  const ctxMap = useOpenSpecMap();
  const map = mapOverride ?? ctxMap;
  useArchiveVersion();
  const sig = cwd ? sigOf(map.get(cwd)) : null;
  // Every render is a "read": requestArchive is idempotent and decides whether a
  // fetch is due (missing / signature changed / TTL / error retry).
  useEffect(() => {
    if (cwd) requestArchive(cwd, sig);
  });
  return cwd ? getArchiveState(cwd, sig) : IDLE_STATE;
}

/**
 * Resolve a session's attachment. `changesFallback` (the caller's active
 * change list for `session.cwd`) is used only when the context map has no
 * entry for that cwd (and is non-empty — an empty list is not authoritative).
 * Returns null when the session has no attachment.
 */
export function useAttachmentResolution(
  session: Pick<DashboardSession, "attachedProposal" | "cwd" | "startedAt" | "gitWorktree"> | undefined,
  changesFallback?: readonly OpenSpecChange[],
): AttachmentResolution | null {
  const map = useOpenSpecMap();
  useArchiveVersion();
  const attached = session?.attachedProposal;
  const active = useMemo(() => {
    if (!session || !attached || map.has(session.cwd) || !changesFallback || changesFallback.length === 0) return map;
    const merged = new Map(map);
    merged.set(session.cwd, { initialized: true, changes: [...changesFallback] });
    return merged;
  }, [map, attached, session, changesFallback]);

  const needed: Array<[string, string | null]> = [];
  let resolution: AttachmentResolution | null = null;
  if (session && attached) {
    resolution = resolveAttachment(session, active, (cwd) => {
      const sig = sigOf(active.get(cwd));
      needed.push([cwd, sig]);
      return getArchiveState(cwd, sig);
    });
  }
  // Every render is a "read": requestArchive is idempotent and decides whether a
  // fetch is due (missing / signature changed / TTL / error retry).
  useEffect(() => {
    for (const [cwd, sig] of needed) requestArchive(cwd, sig);
  });
  return resolution;
}

type SessionForResolution = Pick<DashboardSession, "id" | "attachedProposal" | "cwd" | "startedAt" | "gitWorktree">;

/**
 * Resolve many sessions at once (archive browser reverse link). `preload`
 * supplies an already-fetched listing for the browsed folder so it is not
 * re-read through the cache.
 */
export function useResolvedAttachments(
  sessions: readonly SessionForResolution[],
  preload?: { cwd: string; entries: readonly ArchiveEntry[] },
): Map<string, AttachmentResolution> {
  const map = useOpenSpecMap();
  useArchiveVersion();
  const needed = new Map<string, string | null>();
  const out = new Map<string, AttachmentResolution>();
  for (const s of sessions) {
    if (!s.attachedProposal) continue;
    out.set(
      s.id,
      resolveAttachment(s, map, (cwd) => {
        if (preload && cwd === preload.cwd) return { status: "ok", entries: [...preload.entries] };
        const sig = sigOf(map.get(cwd));
        needed.set(cwd, sig);
        return getArchiveState(cwd, sig);
      }),
    );
  }
  useEffect(() => {
    for (const [cwd, sig] of needed) requestArchive(cwd, sig);
  });
  return out;
}

