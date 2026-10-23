# tls-routes.ts — index

`POST /api/tls/issue {sourceId, name?}` — operator "issue now" (Renew now / Try again now / Check now). `registerTlsRoutes(fastify,{networkGuard,listener})`; same authorization as `PUT /api/config` (`networkGuard`, `ROUTE_TIERS` row `operate`). Sync checks only: listener disabled → 409 (before 404); unknown source / name absent from the source's last list → 404; else 202 and, after the reply, `listener.trigger()` (forced readiness + bypass backoff, joins a running attempt). Denylisted from MCP (`/api/tls/`). See change: add-tailscale-cert-tls.
