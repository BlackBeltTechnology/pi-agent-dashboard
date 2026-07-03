# implement/references/rebuild-matrix.md — index

Reference: full 3-component rebuild matrix. Per-component recipes — extension `npm run reload`/`reload:check`; server `curl -X POST .../api/restart` or `pi-dashboard restart [--dev|--prod]`; client Vite HMR (dev) or `npm run build`+restart (prod). Mode mechanics: `/api/health` `.mode`, dev auto-fallback to `dist/client/`. Fault-tolerant restart (single `/api/restart` path, `server_restarting` quiesce broadcast 5s/60s, no manual kill). Common rebuild-mistake table.
