# useArchiveListing.ts — index

Fetches `GET /api/openspec-archive?cwd=` into `entries: ArchiveEntry[]` with `isLoading`/`error`. Exports `groupByDate(entries)` (sort newest-first) and `filterEntries(entries, query)` (case-insensitive slug match). Re-fetches on `cwd` change; cancels stale fetch.
