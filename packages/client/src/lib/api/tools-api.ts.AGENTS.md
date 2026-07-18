# tools-api.ts — index

Client-side fetch helpers for `/api/tools*` (`fetchTools`, `rescanAll`, `rescanOne`, `setOverride`, `clearOverride`, `downloadDiagnostics`). `fetchTools`/`rescan` return `ToolListEntry[]`; re-export `InstallHints`/`PlatformInstallHint`/`ToolListEntry`. See change: register-bash-and-tool-install-help. Routes through `fetchJson`/`fetchJsonResponse`. See change: guard-client-fetch-json.
