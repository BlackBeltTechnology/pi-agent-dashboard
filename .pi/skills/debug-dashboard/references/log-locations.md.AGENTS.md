# debug-dashboard/references/log-locations.md — index

Persistent file map. `~/.pi/dashboard/`: `server.log` (append, timestamped banners, grep recipes), `server.pid` (stale — use `lsof -i :<port>`), `config.json` (live config, `PUT /api/config`), `zrok.pid`, `model-proxy.jsonl` (50 MB rotation), `tool-overrides.json`. `~/.pi/agent/sessions/`, `auth.json`. `/tmp/pi-test.log`. `dist/client/`. "Where is X" cheatsheet.
