# provider-auth-routes.ts — index

Provider OAuth (delegated to pi-ai) + API-key auth. Exports `registerProviderAuthRoutes`. Routes: `POST .../start`, `GET|DELETE .../flow/:flowId`, `POST .../flow/:flowId/input`, plus `PUT .../api-key`, `DELETE .../:provider`. Awaits every credential write. → see `provider-auth-routes.ts.AGENTS.md` `GET /api/provider-auth/legacy-provider-ids` → `{legacyProviderIds}` (separate route; `/status` stays a bare array). See change: update-pi-core-1-1-adopt-apis.

## harden-auth-credentials (B18)

Audit lines `[provider-auth] <verb> … actor= ip=` after success: `key_set provider=` (PUT api-key), `removed provider=` (DELETE :provider), `oauth_start provider=` (POST start), `flow_input flow=<id8>` (value never logged), `radius_mcp written=` (POST radius/mcp, status 200 only). Via `auth/audit-log.ts`. Tests: `__tests__/provider-auth-audit.test.ts`. See change: harden-auth-credentials.
