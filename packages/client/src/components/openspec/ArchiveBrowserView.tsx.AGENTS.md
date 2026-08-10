# ArchiveBrowserView.tsx — index

Browser view for archived OpenSpec changes. Exports `ArchiveBrowserView`. Uses `useArchiveListing`, `groupByDate`, `filterEntries`; groups via `OpenSpecGroupPills` / `OpenSpecGroupSection`; reads artifacts through inner `ArchiveArtifactReader` wrapping `useOpenSpecReader`. Accepts external groups/assignments from WS broadcast.
