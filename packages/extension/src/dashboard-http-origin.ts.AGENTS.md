# dashboard-http-origin.ts — index

Pure `resolveDashboardHttpOrigin(endpoint, env)`: HTTP origin a REMOTE bridge uses for `/api/*` (ticket mint, identity challenge, live trust query). Order: invalid `PI_DASHBOARD_HTTP_URL` → `bad-http-url`; scoped valid override; plaintext explicit-port `ws:` → host + `resolveDashboardPorts(env).port`; `wss:`/port-less `ws:` → endpoint origin; else `no-http-origin`. Never reads bridge machine config. See change: fix-remote-bridge-ticket-origin.
