# implement/scripts/local-proof-fetch.ts — index

Local-dashboard client for dev-loop scripts. `localFetch(port, path, init)` dials `127.0.0.1:<port>` and mints a fresh `X-Pi-Local-Proof` (shared `httpProofHeaders`) for that method + path from `~/.pi/dashboard/local/token`; no token = no header. `localProofHeaders(method, url)` = a `BusClient` `proofHeaders` provider; `dialHost()` maps `localhost` → `127.0.0.1` (a proof binds an address literal). Used by `restart-server.ts`, `full-rebuild.ts`, `debug-dashboard` scripts. See change: close-container-loopback-impersonation (D5).
