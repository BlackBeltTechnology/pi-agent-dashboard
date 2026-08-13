# doctor-routes.ts — index

Fastify plugin. `GET /api/doctor` returns `{checks, summary, generatedAt}`. Calls `runSharedChecks` with server deps. Auth-gated identically to `/api/config`. Top-level `try/catch` returns 200 fallback row on internal throw (never 500). Omits Electron-only rows. Tunnel section wired via `resolveZrokBinary` (delegates to `getDefaultRegistry().resolve("zrok")` so diagnostic matches Settings ▸ Tools) and `getTunnelWatchdogStatus`. See change: harvest-bootstrap-survivor-fixes, add-tunnel-diagnostic-checks.
