# File Index — Docker packaging

> Part of [pi-agent-dashboard file index](./file-index.md). Loaded on demand.
>
> **Change-history annotations** (e.g. *"See change: foo-bar"*) → OpenSpec changes archived under `openspec/changes/archive/`.
>
> **Update protocol**: see `AGENTS.md` → "Documentation Update Protocol".

| File | Purpose |
|------|---------|
| `docker/.env.example` | Container env knobs, each commented. API keys, `DASHBOARD_PORT`, `PI_GATEWAY_PORT`, `PI_GATEWAY_BIND`, `TUNNEL_ENABLED`, `ZROK_TOKEN`, `PI_SPAWN_STRATEGY`, `MEM_LIMIT`, `PI_WORKSPACES`, `PI_DASHBOARD_PIN_DIRS`. See change: docker-packaging. |
| `docker/.gitignore` | Excludes `.env` + `compose.override.yml` (user-specific). See change: docker-packaging. |
| `docker/Dockerfile` | Multi-stage. base: `node:22-bookworm-slim` + tmux/jq/git/curl/ripgrep/fd-find/build-essential/python3 + code-server (ARG `CODE_SERVER_VERSION`) + zrok (ARG `ZROK_VERSION`). app: non-root pi UID 1000, global `@mariozechner/pi-coding-agent`, npm install+build, npm link, purge build-essential/python3. EXPOSE 8000 9999. VOLUME `/home/pi/.pi` `/home/pi/.zrok2`. ENTRYPOINT `entrypoint.sh`. See change: docker-packaging. |
| `docker/README.md` | User guide. Quick-start, config table, path-identical workspace mounts, volume perf profiles, gateway access, dev mode, Electron remote mode. See change: docker-packaging. |
| `docker/compose.dev.yml` | Dev overlay. Bind-mounts source, anonymous node_modules volume keeps Linux node-pty, exposes 5173, `NODE_ENV=development`, command `start --dev`. See change: docker-packaging. |
| `docker/compose.override.yml.example` | Power-user template. Path-identical workspace binds, `:ro` example, `PI_DASHBOARD_PIN_DIRS`. Copy to `compose.override.yml`. See change: docker-packaging. |
| `docker/compose.yml` | Base compose. Service `pi-dashboard`, `init:true`, env-driven ports, named volumes `pi-state`→`/home/pi/.pi` + `zrok-state`→`/home/pi/.zrok2`, tmpfs `/tmp`, healthcheck `/api/health`, mem limit. Three commented volume perf profiles (default/performance/ephemeral). See change: docker-packaging. |
| `docker/entrypoint.sh` | Runs `seed-auth.js`, seeds spawnStrategy into config.json first-run-only, starts tmux server, execs pi-dashboard with env→flag mapping (`DASHBOARD_PORT`→`--port`, `PI_GATEWAY_PORT`→`--pi-port`, `TUNNEL_ENABLED=0`→`--no-tunnel`). See change: docker-packaging. |
| `docker/scripts/seed-auth.js` | First-run auth seeder. Reads `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GEMINI_API_KEY` → writes `~/.pi/agent/auth.json` (provider ids anthropic/openai/google, `{type:"api_key",key}`) mode 0600. Skips if file exists. See change: docker-packaging. |
| `docker/up.sh` | Workspace launcher. Parses `PI_WORKSPACES` path-separator list, one path-identical `-v dir:dir` RW bind per entry, exports `PI_DASHBOARD_PIN_DIRS`=same list, `docker compose run --service-ports`. See change: docker-packaging. |
