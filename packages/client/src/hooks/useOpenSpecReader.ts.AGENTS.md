# useOpenSpecReader.ts — index

Fetches OpenSpec change artifact content. `activeTab` derives from URL `initialArtifact` (single source of truth). Builds `tabs` from `artifacts` with `statusColor`. `specs` artifact fetches directory + all `spec.md` in parallel. AbortController cancels stale loads. Returns `{ content, isLoading, error, tabs, activeTab, title }`.
