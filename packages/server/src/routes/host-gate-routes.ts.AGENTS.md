# host-gate-routes.ts — index

`GET /api/host-gate` → `HostGateResponse` (`mode`, `envOverridden`, derived `admitted`, `recent` refusal ring); the one read the Settings ▸ Security ▸ Allowed hostnames section consumes. Auth parity with `GET /api/config` by construction (same global onRequest chain + same `networkGuard` preHandler). `registerHostGateRoutes(fastify, {getCtx, state, networkGuard})`. See change: add-host-allowlist-admission.
