import type { ArchiveEntry } from "@blackbelt-technology/pi-dashboard-shared/archive-types.js";
import { useEffect, useState } from "react";
import { getApiBase } from "../lib/api/api-context.js";
import { t } from "../lib/i18n/i18n.js";

export type { ArchiveEntry };

interface ArchiveListingState {
  entries: ArchiveEntry[];
  isLoading: boolean;
  error: string | undefined;
}

export function useArchiveListing(cwd: string): ArchiveListingState {
  const [entries, setEntries] = useState<ArchiveEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(undefined);

    fetch(`${getApiBase()}/api/openspec-archive?cwd=${encodeURIComponent(cwd)}`)
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        if (!body.success) {
          setError(body.error ?? t("archive.fetchFailed", undefined, "Failed to fetch archive"));
        } else {
          setEntries(body.data);
        }
        setIsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message ?? t("archive.fetchFailed", undefined, "Failed to fetch archive"));
        setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [cwd]);

  return { entries, isLoading, error };
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
