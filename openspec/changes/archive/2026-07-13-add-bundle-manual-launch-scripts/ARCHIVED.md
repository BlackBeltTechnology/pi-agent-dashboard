# ARCHIVED — 2026-07-13

Reason: **already shipped.** The work this change proposes exists in the codebase.

Evidence (drift audit 2026-07-13):
- `packages/electron/scripts/server-launch-helpers/start-server.cmd` — exists, header cites this change.
- `packages/electron/scripts/server-launch-helpers/start-server.ps1` — exists, same header.
- `packages/electron/scripts/server-launch-helpers/start-server.sh` — exists (`chmod +x`), same header.
- `packages/electron/scripts/server-launch-helpers/README.md` — exists.
- `packages/electron/scripts/bundle-server.mjs` — `cpSync` loop copies all 4 files into the server bundle.

The scripts were authored and wired during other bundle work without checking off this change's tasks. Only optional follow-up (a CI assertion) was never added; not worth keeping the change open. Original artifacts preserved below for history.
