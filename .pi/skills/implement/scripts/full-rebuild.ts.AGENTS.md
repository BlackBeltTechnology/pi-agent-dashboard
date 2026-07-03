# implement/scripts/full-rebuild.ts — index

Deploy checked-out dev version to local running instance. 3 steps in order: `npm run build` → `POST /api/restart` → `npm run reload`. Reads port from `~/.pi/dashboard/config.json` (default 8000). NOT a feature-implementation step — worktree/Docker-isolated work skips it. Cross-platform (npm.cmd on Windows).
