/**
 * Pure resolver: a session's bare `attachedProposal` name → active change,
 * archive entry, missing, or unresolved (data not settled / OpenSpec off).
 *
 * Lookup order: active(cwd) → active(mainPath) → archive(cwd) → archive(mainPath).
 * See change: resolve-archived-attached-proposal (D1–D3).
 */
import type { ArchiveEntry } from "@blackbelt-technology/pi-dashboard-shared/archive-types.js";
import type { DashboardSession, OpenSpecChange, OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export interface ArchiveState {
  status: "idle" | "loading" | "ok" | "error";
  entries: ArchiveEntry[];
}

export type AttachmentResolution =
  | { kind: "active"; change: OpenSpecChange; cwd: string }
  | { kind: "archived"; entry: ArchiveEntry; cwd: string }
  | { kind: "missing" }
  | { kind: "unresolved"; reason: "loading" | "disabled" | "error" };

type SessionLike = Pick<DashboardSession, "attachedProposal" | "cwd" | "startedAt"> & {
  gitWorktree?: Pick<NonNullable<DashboardSession["gitWorktree"]>, "mainPath">;
};

type FolderState = { state: "known"; data: OpenSpecData } | { state: "unavailable" } | { state: "unsettled" };

function folderState(data: OpenSpecData | undefined): FolderState {
  // `initialized` data is authoritative even if `pending` is still set (a poll
  // refresh over already-known data) — never flip a known folder back to loading.
  if (data?.initialized) return { state: "known", data };
  if (!data || data.pending === true) return { state: "unsettled" };
  return { state: "unavailable" };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local calendar date of `ms` minus one day, as YYYY-MM-DD. */
function startDay(ms: number): string {
  const d = new Date(ms);
  const prev = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  return `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-${pad(prev.getDate())}`;
}

/** Entries whose name is `<YYYY-MM-DD>-<name>` (exact, regex-escaped). */
export function matchArchiveEntries(entries: readonly ArchiveEntry[], name: string): ArchiveEntry[] {
  const re = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${escapeRegExp(name)}$`);
  return entries.filter((e) => re.test(e.name));
}

function pickEntry(candidates: ArchiveEntry[], startedAt: number): ArchiveEntry {
  const sorted = [...candidates].sort((a, b) => b.date.localeCompare(a.date));
  const day = startDay(startedAt);
  return sorted.find((e) => e.date >= day) ?? sorted[0];
}

/** Steps 1+2: search the active changes of each folder. */
function resolveActive(
  name: string,
  folders: string[],
  activeByCwd: ReadonlyMap<string, OpenSpecData>,
): { hit: AttachmentResolution | null; unsettled: boolean } {
  let unsettled = false;
  for (const f of folders) {
    const s = folderState(activeByCwd.get(f));
    if (s.state === "unsettled") {
      unsettled = true;
      continue;
    }
    const change = s.state === "known" ? s.data.changes.find((c) => c.name === name) : undefined;
    if (change) return { hit: { kind: "active", change, cwd: f }, unsettled };
  }
  return { hit: null, unsettled };
}

/** Steps 3+4: search the archive of each folder. */
function resolveArchive(session: SessionLike, name: string, folders: string[], getArchive: (cwd: string) => ArchiveState): AttachmentResolution {
  let pending = false;
  let failed = false;
  for (const f of folders) {
    const a = getArchive(f);
    if (a.status === "ok") {
      const candidates = matchArchiveEntries(a.entries, name);
      if (candidates.length > 0) return { kind: "archived", entry: pickEntry(candidates, session.startedAt), cwd: f };
    } else if (a.status === "error") {
      failed = true;
    } else {
      pending = true;
    }
  }
  if (pending) return { kind: "unresolved", reason: "loading" };
  return failed ? { kind: "unresolved", reason: "error" } : { kind: "missing" };
}

export function resolveAttachment(
  session: SessionLike,
  activeByCwd: ReadonlyMap<string, OpenSpecData>,
  getArchive: (cwd: string) => ArchiveState,
): AttachmentResolution {
  const name = session.attachedProposal;
  if (!name) return { kind: "missing" };
  const cwd = session.cwd;
  const mainPath = session.gitWorktree?.mainPath;
  const folders = mainPath && mainPath !== cwd ? [cwd, mainPath] : [cwd];

  const ownReadiness = activeByCwd.get(cwd)?.readiness?.state;
  if (ownReadiness === "GLOBAL_OFF" || ownReadiness === "OPTED_OUT") return { kind: "unresolved", reason: "disabled" };

  const active = resolveActive(name, folders, activeByCwd);
  if (active.hit) return active.hit;
  if (active.unsettled) return { kind: "unresolved", reason: "loading" };
  return resolveArchive(session, name, folders, getArchive);
}
