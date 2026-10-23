# implement/scripts/restart-server.ts — index

Restart server via `POST /api/restart`. Flags: none (keep mode), `--dev` (body `{"dev":true}`), `--prod` (`{"dev":false}`). Polls `/api/health` up to 10s after restart accepted; exits 1 if not healthy. Reads port from `~/.pi/dashboard/config.json` (default 8000). Bad arg → usage + exit 2.

POSTs to the loopback literal with a minted proof via `local-proof-fetch.ts` (a bare localhost fetch is refused by the strict `requireLocalProof` default). See change: close-container-loopback-impersonation (D5).
