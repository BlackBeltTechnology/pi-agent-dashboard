# tunnel-endpoints.ts — index

"Accessible at" enumeration — `collectEndpoints` merges provider endpoints + manual `pairing.publicBaseUrls` + LAN/local into tagged `{kind,url,tls}`; `manualEndpoints`/`localEndpoints`/`toReachableUrlStrings`. `tls` advisory; the https/wss gate stays authoritative in `pairing.reachableUrls()`. See change: add-tunnel-providers.

`liveReadinessEndpoints(readiness)` — flattens endpoints of every `connected` provider (primary + extras + OS-level daemons via `probeLive`), drops url-less markers. `/api/tunnel/endpoints` (system-routes.ts) merges it into `providerEndpoints` so the QR network selector lists domain URLs (tailscale MagicDNS, extra zrok/ngrok); readiness failure degrades to primary+manual+LAN.
