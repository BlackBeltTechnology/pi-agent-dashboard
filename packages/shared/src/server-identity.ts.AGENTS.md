# server-identity.ts — index

Identity-verified dashboard detection over GET /api/health. Exports `DashboardStatus`, `DashboardCheckOpts`, `isDashboardRunning(port, host?, opts?)`. Replaces bare TCP port probe; flags `portConflict` for foreign JSON on HTTP 200. Bounded retry loop via `opts.retries` / `timeoutMs` / `retryDelayMs`; defaults preserve legacy single-attempt 2 s behaviour.
