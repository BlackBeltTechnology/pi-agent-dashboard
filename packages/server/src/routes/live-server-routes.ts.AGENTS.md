# live-server-routes.ts — index

Live-server-preview REST. `registerLiveServerRoutes`. `POST /api/live-server/start {host,port,label}` (SSRF gate via manager `validateLiveTarget`; non-loopback→400; returns proxied `/live/<id>/` path), `GET /api/live-server/list`, `DELETE /api/live-server/:id`. See change: improve-content-editor.
