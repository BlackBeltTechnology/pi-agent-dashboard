# usePiResources.ts — index

Fetches `GET /api/pi-resources?cwd=&refresh=` into `data: PiResourcesResult` with `isLoading`/`error`/`refresh`. Polls every 30s. Guards against stale `cwd` via ref. Clears state when `cwd` is null. `usePiResources(null,{globalOnly:true})` omits cwd (server scans its own cwd) for the global Settings resource pages; caller reads `data.global`. See change: resources-card-tabs.
