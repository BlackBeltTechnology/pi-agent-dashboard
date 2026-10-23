# implement/scripts/full-rebuild.ts — index

Deploy checked-out dev version to local running instance. 3 steps in order: `npm run build` → `POST /api/restart` → `npm run reload`. Reads port from `~/.pi/dashboard/config.json` (default 8000). NOT a feature-implementation step — worktree/Docker-isolated work skips it. Cross-platform (npm.cmd on Windows). Step 2 waits for `/api/health` to report a NEW `pid` (≤60s, exit 1 otherwise) — no reload against the down/old server. Step 3 retries `npm run reload` every 5s (≤6 tries) while output says `No connected pi sessions found.` (bridges reconnect with backoff).

Health probe and restart POST go through `localFetch` (loopback literal + minted proof). See change: close-container-loopback-impersonation (D5).
