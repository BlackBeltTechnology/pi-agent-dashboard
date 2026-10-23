# pi-trust-query-routes.ts — index

`POST /api/pi-trust/query`: verified local proof (loopback, no forwarding, endpoint-bound) or operate device; limiter 20/200 per 10 s; permits 4 global/1 device; local answer = recorded identity, remote = salt+digest; counters → `/api/health` `piTrustMirror.live`; logs sanitized. See change: mirror-dashboard-trust-live-remote.
