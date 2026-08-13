# provider-auth-routes.ts — index

Browser-based pi provider OAuth + API-key auth. Exports `registerProviderAuthRoutes`. Endpoints: `GET /api/provider-auth/providers|handlers|status`, `POST .../authorize` (auth-code + callback server), `POST .../device-code`, `GET .../device-status/:flowId`, `PUT .../api-key`, `DELETE .../:provider`. In-memory PKCE/device-code flow store with 10-min TTL. Notifies bridges `credentials_updated` + eager-refreshes model registry.
