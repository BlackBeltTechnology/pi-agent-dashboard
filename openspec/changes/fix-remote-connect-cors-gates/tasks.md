# Tasks

## 1. Server CORS — allow trusted-network origins (surface 2 enabler)

- [ ] 1.1 In `packages/server/src/server.ts` CORS `origin` callback, after the loopback/tunnel/`*.share.zrok.io`/`pi-dashboard.dev`/configured checks and BEFORE the final `cb(null, false)`, add a branch: parse `origin` → host; if `config.resolvedTrustedNetworks` is non-empty AND `isBypassedHost(host, resolvedTrustedNetworks)` matches, `cb(null, true)`.
  - Reuse `isBypassedHost` from `localhost-guard.ts` (exact IP / CIDR / wildcard).
  - Keep the `origin === "null" → cb(null, false)` branch UNTOUCHED (intentional refusal).
  - Keep unknown-origin `cb(null, false)` as the final fallthrough.
  - Thread `resolvedTrustedNetworks` into the CORS registration (it is already on `config`; confirm it is in scope where `cors` is registered, else pass it via the server options like `corsAllowedOrigins`).
- [ ] 1.2 Unit tests (`packages/server/src/__tests__/` — cors/origin behavior):
  - Origin host in a `trustedNetworks` CIDR (`192.168.16.0/24`) → ACAO echoed.
  - Origin host NOT in any trusted network and not otherwise allowed → no ACAO.
  - `Origin: null` with a permissive `trustedNetworks` → still no ACAO (refusal preserved).
  - Empty `trustedNetworks` → behavior identical to today (loopback/tunnel/shell/configured only).
  - Wildcard (`192.168.*.*`) and exact-IP trusted entries both match.

## 2. Electron remote attach — probe in main, navigate in renderer (surface 1)

- [ ] 2.1 Expose a main-process reachability probe to the loading page. Add `probeServer(url: string): Promise<{ ok: boolean; version?: string; reason?: string }>` to the main preload bridge (`piDashboard` namespace) backed by an `ipcMain.handle("dashboard:probe-server", …)` that calls the existing `probeRemote` in `remote-connect-window.ts` (extract `probeRemote` to a shared module if importing it into `main` is awkward).
- [ ] 2.2 In `loading.html`'s `tryConnect`, when `window.piDashboard?.probeServer` exists AND `serverUrl` is a **non-loopback** URL, await `piDashboard.probeServer(serverUrl)` instead of the renderer `fetch`. On `ok`, `location.href = serverUrl`. On not-ok, keep the existing retry + `showError()` timing.
  - Fallback: if the IPC is unavailable (older preload), retain the current renderer `fetch` path so local/loopback attach is unchanged.
  - Do NOT change the known-servers buttons (`loading.html:97`) — they already navigate directly.
- [ ] 2.3 Verify the remote-attach startup path (`main.ts` remote block) still calls `createMainWindow(remoteUrl)` + `showLoadingPage(win, remoteUrl)`; the fix lives entirely in how the loading page decides to navigate, so no startup-arm restructure is needed.
- [ ] 2.4 Tests: unit-test the extracted `probeRemote` (already testable — Node fetch with timeout: ok / non-200 / abort → `Timed out` / network → `Connection refused`). Add a `loading.html` logic test if the page's script is factored into a testable module; otherwise cover via the Electron smoke in §5.

## 3. Web transactional switch — carry a WS ticket to the target (surface 2)

- [ ] 3.1 Add a client helper `mintWsTicket(base: string, scope: "/ws"): Promise<string | null>` that `POST`s the existing ws-ticket mint endpoint against the **target** server's origin (not the current one) and returns the ticket. It relies on §1 CORS allowance to read the response cross-origin; returns `null` on failure.
- [ ] 3.2 In `performServerSwitch` (`server-switch.ts`), before opening the staging socket, mint a ticket against the target and append it (`?ticket=<t>` per `ticketFromUrl`, or the `pi-ticket.<t>` subprotocol). Open `ws://<host>:<port>/ws?ticket=<t>`. On mint failure, abort the switch with a clear error (do NOT open a ticket-less socket that the server will refuse).
- [ ] 3.3 The committed connection (the `useWebSocket` hook URL set via `setWsUrl`) MUST also carry a freshly-minted ticket for the target (staging tickets are single-use/consumed). Ensure the URL handed to `setWsUrl` includes a valid ticket, or that the hook mints one on connect.
- [ ] 3.4 In `ServerSelector.tsx` probe handler, distinguish an **opaque/blocked** cross-origin failure (the `.catch()` transport path where no response was readable) from a genuine unreachable: when the entry host is in a known/trusted network but the probe threw with no readable response, render a distinct "CORS-blocked — allowlist this origin on the remote" hint (reuse the `denied` visual family, distinct copy) instead of "Unreachable". Keep the existing `403 network_not_allowed` → "Network not allowed" branch.
- [ ] 3.5 Tests:
  - `performServerSwitch` mints a ticket and includes it in the staging URL (inject `mintWsTicket` + `openStagingSocket`; assert URL carries `ticket=`).
  - Mint failure → switch aborts, `notifyError` called, live connection preserved (no `setWsUrl`).
  - `ServerSelector` probe: transport `.catch()` for a trusted-network host → "CORS-blocked" hint; 403 body → "Network not allowed"; non-ok → "Unreachable" (existing).

## 4. Cross-cutting verification

- [ ] 4.1 `npm test` green (root + `packages/server`, `packages/client`, `packages/electron`).
- [ ] 4.2 `npm run quality:changed` clean (Biome + tsc + tests on the diff).

## 5. Validate (manual, against a real LAN remote)

- [ ] 5.1 On a second machine, run the dashboard and add the first machine's network to `trustedNetworks`. Confirm `curl -H "Origin: http://<lan-ip>:8000" http://<lan-ip>:8000/api/health` now returns `access-control-allow-origin`.
- [ ] 5.2 Web: from a browser tab served by server A, open the header dropdown, pick server B (trusted-network LAN remote). Confirm the row is NOT disabled, the switch commits (staging socket opens, sessions rehydrate), and no state loss on the live connection.
- [ ] 5.3 Web negative: pick a LAN remote whose network is NOT trusted → row shows the new "CORS-blocked — allowlist this origin" hint (not a bare "Unreachable"), and switching is blocked.
- [ ] 5.4 Electron: "Connect to Remote Dashboard" → enter `http://<lan-ip>:8000` → Test Connection OK → Connect → app relaunches and **attaches to the remote dashboard** (no ~15 s hang, no error page) with the remote's sessions visible.
- [ ] 5.5 Electron regression: local (standalone) launch still shows the loading page and attaches to `http://localhost:<port>` exactly as before.
- [ ] 5.6 Security check: confirm `Origin: null` to `/api/health` still returns NO `access-control-allow-origin` even with a permissive `trustedNetworks` (the intentional refusal is intact).
