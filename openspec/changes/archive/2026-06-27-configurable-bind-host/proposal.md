## Why

The dashboard HTTP server binds to `0.0.0.0` unconditionally (`packages/server/src/server.ts` — `fastify.listen({ port, host: "0.0.0.0" })`), and the pi gateway WebSocket server binds all interfaces by omitting `host` entirely (`new WebSocketServer({ port })`). This puts both ports on every network interface for every install — native, Electron, and Docker alike — even though most users run the dashboard purely locally. GitHub issue #48 flags this: "jiti listen on 0.0.0.0 - it's a bad solution. Please default to 127.0.0.1."

An app-layer guard (loopback + trusted-networks + auth) already rejects untrusted requests, so this is not "wide open." But binding all interfaces by default violates defense-in-depth: the socket is reachable and probeable on the LAN even when the guard would reject, so a single guard regression becomes exposure. The safe default is loopback, with explicit opt-in for routable interfaces.

The bind host is currently hardcoded. There is no flag, no env var, and no config field — unlike `port`/`piPort`, which already resolve through CLI flag → env var → config.json → default. We mirror that established chain for the bind host.

## What Changes

- Default the HTTP server and pi gateway to bind `127.0.0.1` instead of all interfaces.
- Add a `bindHost` resolution chain mirroring `port`: `--host` CLI flag → `PI_DASHBOARD_HOST` env var → `config.bindHost` (config.json) → `"127.0.0.1"` default.
- One `bindHost` governs both the HTTP listener and the pi gateway WS listener (shared trust boundary). The model-proxy second port stays `127.0.0.1` (already loopback; SDK-local concern).
- Settings UI (General tab) gains a 3-way listen-interface picker: Local only (`127.0.0.1`), All interfaces (`0.0.0.0`), Specific interface (NIC dropdown fed by the existing `GET /api/network-interfaces`). Changing it requires a restart (added to `RESTART_FIELDS`), surfaced with the existing restart-required banner.
- Selecting All interfaces with neither auth nor trusted networks configured shows an exposure warning; the guard behavior itself is unchanged.
- Docker all-in-one image and any remote/LAN deployment must set `PI_DASHBOARD_HOST=0.0.0.0` to stay reachable — the container declares its exposure intent rather than every local user inheriting it.

## Capabilities

### New Capabilities
- `server-bind-host`: configurable listen interface for the dashboard HTTP server and pi gateway, defaulting to loopback, resolved through flag/env/config with a safe hardcoded fallback.

### Modified Capabilities
<!-- none -->

## Impact

- `packages/server/src/server.ts` — HTTP listen uses `config.host`; pi gateway start receives + binds `config.host`.
- `packages/server/src/pi-gateway.ts` — `start()` accepts a `host` and passes it to `new WebSocketServer({ port, host })`.
- `packages/server/src/cli.ts` — `parseArgs()` adds `--host`; `buildConfig()` adds the `host` resolution line; `ServerConfig` gains `host`.
- `packages/shared/src/config.ts` — `DashboardConfig` gains `bindHost: string`; `DEFAULTS.bindHost = "127.0.0.1"`; `loadConfig()` reads it.
- `packages/server/src/config-api.ts` — add `"bindHost"` to `RESTART_FIELDS`.
- Client Settings General tab — listen-interface picker + exposure warning.
- `docker/` — `compose.yml` / `.env.example` set `PI_DASHBOARD_HOST=0.0.0.0`.
- Docs: `docs/architecture.md` (bind model), `docs/file-index-server.md` + `docs/file-index-shared.md` rows.
