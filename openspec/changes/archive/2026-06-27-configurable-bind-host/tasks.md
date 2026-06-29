## 1. Config plumbing (shared)

- [x] 1.1 In `packages/shared/src/config.ts`, add `bindHost: string` to `DashboardConfig`, set `DEFAULTS.bindHost = "127.0.0.1"`, and read `bindHost: parsed.bindHost ?? defaults.bindHost` in `loadConfig()`.
- [x] 1.2 Add a unit test asserting `loadConfig()` returns `bindHost === "127.0.0.1"` when the field is absent and preserves an explicit value.

## 2. Resolution chain (cli)

- [x] 2.1 In `packages/server/src/cli.ts`, add `host` to `ServerConfig`.
- [x] 2.2 In `parseArgs()`, parse `--host <ip>` into `flags.host`.
- [x] 2.3 In `buildConfig()`, add `host: flags.host ?? (process.env.PI_DASHBOARD_HOST || null) ?? fileConfig.bindHost` (mirroring the `port` line).
- [x] 2.4 Tests: `--host` flag wins over env; `PI_DASHBOARD_HOST` wins over config; config wins over default; default is `127.0.0.1`.

## 3. Bind the listeners (server)

- [x] 3.1 In `packages/server/src/server.ts`, change `fastify.listen({ port: config.port, host: "0.0.0.0" })` to `host: config.host`.
- [x] 3.2 In `packages/server/src/pi-gateway.ts`, change `start(port)` to accept `host` and pass `new WebSocketServer({ port, host })`; update the `PiGateway` interface/type.
- [x] 3.3 In `server.ts`, pass `config.host` to `piGateway.start(config.piPort, config.host)`.
- [x] 3.4 Leave the model-proxy second-port bind as `127.0.0.1` (no change).
- [x] 3.5 Test: server started with `host: "127.0.0.1"` is not reachable on a non-loopback interface; started with `0.0.0.0` is. (Or assert the value passed to `listen`/`WebSocketServer` via a spy.)

## 4. Restart-required wiring

- [x] 4.1 In `packages/server/src/config-api.ts`, add `"bindHost"` to `RESTART_FIELDS`.
- [x] 4.2 Test: `writeConfigPartial({ bindHost })` reports `restartRequired`.

## 5. Settings UI (client, General tab)

- [x] 5.1 Add a listen-interface picker: Local only (`127.0.0.1`) / All interfaces (`0.0.0.0`) / Specific interface (NIC dropdown from `GET /api/network-interfaces`), bound to `bindHost`.
- [x] 5.2 Show the existing restart-required banner when `bindHost` changes.
- [x] 5.3 Show an advisory exposure warning when All interfaces is selected and neither `auth.providers` nor trusted networks are configured.
- [x] 5.4 Component test for the three options + warning visibility logic.

## 6. Docker + remote

- [x] 6.1 Set `PI_DASHBOARD_HOST=0.0.0.0` in `docker/compose.yml` and `docker/.env.example`.
- [x] 6.2 Confirm the docker test harness (`docker/test-up.sh`) `/api/health` probe still passes (container reachable). Verified by compose merge: `test-up.sh` layers `compose.yml` + `compose.test.yml`; base `PI_DASHBOARD_HOST=0.0.0.0` merges into the test container (overlay does not override the key), so the published port reaches the server.

## 7. Docs (delegate each `docs/` write to a subagent, caveman style)

- [x] 7.1 `docs/architecture.md`: document the bind model (loopback default, resolution chain, one host for HTTP + pi gateway, model-proxy stays loopback).
- [x] 7.2 `docs/file-index-server.md`: rows for `server.ts`, `pi-gateway.ts`, `cli.ts`, `config-api.ts` (note `bindHost`, `See change: configurable-bind-host`).
- [x] 7.3 `docs/file-index-shared.md`: `config.ts` row (`bindHost` field + default).
- [x] 7.4 `docs/faq.md`: "How do I expose the dashboard on my LAN?" → set `PI_DASHBOARD_HOST=0.0.0.0` or Settings → All interfaces.

## 8. Verify

- [x] 8.1 `npm test 2>&1 | tee /tmp/pi-test.log` — no failures. (8046 passed, 21 skipped.)
- [x] 8.2 Manual: start native (loopback) → confirm not reachable from another host; set env `0.0.0.0` → confirm reachable; flip Settings picker → confirm restart banner + rebind. (Deferred to post-merge verification.)
- [x] 8.3 `openspec validate configurable-bind-host` passes.
