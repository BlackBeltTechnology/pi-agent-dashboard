# live-server-routes.ts — index

Live-server-preview REST. `registerLiveServerRoutes`. `POST /api/live-server/start {host,port,label}` (SSRF gate via manager `validateLiveTarget`; non-loopback→400; returns proxied `/live/<id>/` path), `GET /api/live-server/list`, `DELETE /api/live-server/:id`. See change: improve-content-editor.

`POST /api/live-server/:id/capability` mints a capability URL; flat `{success,path,expiresAt}`; `capabilityPrincipalOf` derives principal. `DELETE /api/live-server/:id` revokes target tokens. See change: retire-trusted-networks-bypass.
