# pending-client-correlations.ts — index

Maps server-minted `spawnToken` → client-minted `requestId`. Exports `PendingClientCorrelations`, `createPendingClientCorrelations`. `record`/`consume`/`dispose`/`size`; 60s TTL aligned with `spawn-register-watchdog` recovery window so late `session_added` broadcasts carry `spawnRequestId` for client auto-select. In-memory only.
