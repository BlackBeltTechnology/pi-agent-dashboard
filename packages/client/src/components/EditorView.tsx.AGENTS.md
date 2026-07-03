# EditorView.tsx — index

Embedded VS Code editor panel. Exports `EditorView`. State: loading/ready/error/not_found. POSTs `/api/editor/start` (deduped via `startInFlightRef`), renders iframe at `proxyPath`, heartbeat every 30s restarts on evict, syncs theme via `/api/editor/<id>/theme` + iframe reload. Falls back to `EditorInstallGuide` on `binary_not_found`.
