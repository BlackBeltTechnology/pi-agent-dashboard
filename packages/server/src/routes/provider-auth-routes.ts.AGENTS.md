# provider-auth-routes.ts — index

Provider OAuth (delegated to pi-ai) + API-key auth. Exports `registerProviderAuthRoutes`. Routes: `POST .../start`, `GET|DELETE .../flow/:flowId`, `POST .../flow/:flowId/input`, plus `PUT .../api-key`, `DELETE .../:provider`. Awaits every credential write. → see `provider-auth-routes.ts.AGENTS.md` `GET /api/provider-auth/legacy-provider-ids` → `{legacyProviderIds}` (separate route; `/status` stays a bare array). See change: update-pi-core-1-1-adopt-apis.
