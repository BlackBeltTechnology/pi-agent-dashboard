# pending-load-manager.ts — index

Tracks in-flight on-demand session-load requests from bridge extensions. Dedupes concurrent loads, 10s timeout, cancels pending loads on bridge disconnect. Exports `createPendingLoadManager`, `PendingLoadManager` (`start`/`addBrowser`/`cancel`/`cancelForBridge`/`dispose`), `PendingLoad`. `onTimeout` callback fires per expired entry.
