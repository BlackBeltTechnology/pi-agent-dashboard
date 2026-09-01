# model-proxy-diagnostics-routes.ts — index

`GET /api/model-proxy/diagnostics`. JWT-gated, main instance only (NOT second `/v1` proxy port). `registerModelProxyDiagnosticsRoutes(fastify)`. Returns `getAllAnnotated()` → `{id, provider, excludedReason}` per model (`null` \| `no-credential` \| `oauth-incompatible`). Sibling to `model-proxy-refresh-routes.ts`; resolves registry via `getModelRegistry()` singleton. 503 when pi-ai unresolved. See change: filter-oauth-incompatible-models.
