## 1. Regression test first (TDD)

- [x] 1.1 Add a server WS-upgrade test in `packages/server/src/__tests__/` that boots the server (or the upgrade handler) with a real `WsTicketStore`, mints a browser-scope ticket via `POST /api/ws-ticket` (authenticated path), then opens `GET /ws?ticket=<t>` and asserts `101 Switching Protocols` + the browser gateway receives the connection.
- [x] 1.2 Assert the test FAILS against current `main` (ticketed upgrade → socket destroyed / no `101`), proving it reproduces the bug.
- [x] 1.3 Add negative cases that must still pass: bare-path remote upgrade without a ticket → refused; reused/expired ticket → refused; a `browser` ticket presented to `/ws/terminal/<id>` → refused (scope binding intact).
- [x] 1.4 Cover BOTH branches: `authConfig.secret` configured, and no-auth-configured (the `else` branch that checks genuine-local / local-token / trusted / ticket).

## 2. Fix the routing

- [x] 2.1 In `packages/server/src/server.ts` (`fastify.server.on("upgrade", …)`), replace the `request.url === "/ws"` / `request.url?.startsWith(...)` dispatch chain with routing on the already-computed `scope` from `routeScopeForUrl(request.url)` (`"browser"→browserGateway`, `"terminal"→terminalGateway`, `"editor"→handleEditorUpgrade`, `"live"→handleLiveServerUpgrade`, else `socket.destroy()`).
- [x] 2.2 Verify the query string is stripped for routing (either via `scope` or `request.url.split("?")[0]`), and that terminal/editor/live dispatch is byte-for-byte equivalent to today for their existing (query-less) URLs.
- [x] 2.3 Confirm no client change is needed (`useWebSocket` already appends `?ticket=`); do not touch `packages/client`.

## 3. Verify

- [x] 3.1 Run the new test suite → all pass (`npm test 2>&1 | tee /tmp/pi-test.log`; grep failures).
- [x] 3.2 (tested later) Manual: pair a device over the tunnel (or LAN) and confirm the dashboard connects (banner leaves "Offline") and receives session data.
- [x] 3.3 (tested later) Manual: same-machine no-bearer browser still connects on bare `/ws` (no regression to the local path).
- [x] 3.4 (tested later) Deploy locally per the server-change workflow (restart via `POST /api/restart`); reconfirm a real paired browser + Android PWA connect.

## 4. Out of scope (track separately)

- [x] 4.1 No action: the brief zrok reserved-share churn in server.log was upstream 5xx from the hosted service (`clientVersionCheck` 502/503/504, `[POST /share][500]`) — a transient zrok.io outage, not a client-version issue. Installed zrok v1.1.11 is current; the share self-healed. Do NOT reinstall/upgrade zrok for this.
