# ResourceCardGrid.tsx — index

Auto-fill grid of `ResourceCard` for one type. Exports `ResourceCardGrid`, `ResourceType`, `countResources`. Flattens loose+package resources across `scopes`; search box + optional `All/Local/Global` scope filter. `themes` now part of `PiResourceScope`. Skills only: an `All/active/not-loaded/loaded-elsewhere` provenance filter (hidden when the payload is `scanOnly` or `degraded`), plus explicit scan-only / degraded notices above the grid. See change: resources-card-tabs, fix-skill-discovery-parity.
