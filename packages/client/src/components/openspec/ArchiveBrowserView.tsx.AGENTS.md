# ArchiveBrowserView.tsx — index

Browser view for archived OpenSpec changes. Exports `ArchiveBrowserView`. Uses `useArchiveListing`, `groupByDate`, `filterEntries`; groups via `OpenSpecGroupPills` / `OpenSpecGroupSection`; reads artifacts through inner `ArchiveArtifactReader` wrapping `useOpenSpecReader`. Accepts external groups/assignments from WS broadcast.

Props `deepLink` (reader opened from URL, history-back) + `sessions` (per-entry attached-session chips, max 3 + `+N`). See change: resolve-archived-attached-proposal.
