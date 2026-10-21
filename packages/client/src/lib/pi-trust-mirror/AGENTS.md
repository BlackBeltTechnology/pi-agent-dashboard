# DOX — packages/client/src/lib/pi-trust-mirror

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `pi-trust-mirror-api.ts` | Client transport + defaults for the dashboard-trust → pi mirror. `fetchPiTrustMirrorConfig` (checkbox defaults from `GET /api/config`), `fetchPiTrustAccess` (`GET /api/access/pi-trust`), `setPiTrustChoice` (`PUT /api/access/pi-trust/choice`), `setPiTrustMirrorConfig` (`PUT /api/config`), `normalizeMirrorSettings`. See change: mirror-dashboard-trust-to-pi. Adds `liveQuery`, `liveQueryTimeoutMs`, `sources.yolo`, `PiTrustLiveLifetime`, `live`/`lifetime` on rows; `setPiTrustMirrorConfig` accepts `liveQueryTimeoutMs: null` to clear. See change: mirror-dashboard-trust-live-remote. |
