# model-proxy-api-key-routes.ts — index

Proxy API key CRUD (JWT-gated management surface). Exports `registerModelProxyApiKeyRoutes`, `ApiKeyRoutesDeps`. Endpoints: `GET/POST /api/model-proxy/api-keys`, `POST .../:id/revoke` (soft-delete), `DELETE .../:id` (hard-delete). Cleartext revealed once on create. Scopes + expiry. Admin vs owner filtering.
