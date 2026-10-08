import type { ArchiveEntry } from "@blackbelt-technology/pi-dashboard-shared/archive-types.js";
import { useArchiveEntries } from "../lib/openspec/useAttachmentResolution.js";

export type { ArchiveEntry };

interface ArchiveListingState {
  entries: ArchiveEntry[];
  isLoading: boolean;
  error: string | undefined;
}

/** Archive listing for `cwd`, read through the shared per-folder cache.
 *  See change: resolve-archived-attached-proposal (D4). */
export function useArchiveListing(cwd: string): ArchiveListingState {
  const s = useArchiveEntries(cwd);
  return {
    entries: s.status === "ok" ? s.entries : [],
    isLoading: s.status === "idle" || s.status === "loading",
    error: s.status === "error" ? s.error : undefined,
  };
}

/** Group entries by date and return groups sorted newest-first. */
export function groupByDate(entries: ArchiveEntry[]): { date: string; entries: ArchiveEntry[] }[] {
  const map = new Map<string, ArchiveEntry[]>();
  for (const entry of entries) {
    const group = map.get(entry.date) ?? [];
    group.push(entry);
    map.set(entry.date, group);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, entries]) => ({ date, entries }));
}

/** Filter entries by search query (case-insensitive slug match). */
export function filterEntries(entries: ArchiveEntry[], query: string): ArchiveEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((e) => e.name.toLowerCase().includes(q));
}
