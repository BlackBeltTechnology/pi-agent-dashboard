# Tasks

## 1. Server CORS — allow trusted-network origins (surface 2 enabler)

- [x] 1.1 In `packages/server/src/server.ts` CORS `origin` callback, after the loopback/tunnel/`*.share.zrok.io`/`pi-dashboard.dev`/configured checks and BEFORE the final `cb(null, false)`, add a branch: parse `origin` → host; if `config.resolvedTrustedNetworks` is non-empty AND `isBypassedHost(host, resolvedTrustedNetworks)` matches, `cb(null, true)`.
  - Reuse `isBypassedHost` from `localhost-guard.ts` (exact IP / CIDR / wildcard).
  - Keep the `origin === "null" → cb(null, false)` branch UNTOUCHED (intentional refusal).
  - Keep unknown-origin `cb(null, false)` as the final fallthrough.
  - Thread `resolvedTrustedNetworks` into the CORS registration (it is already on `config`; confirm it is in scope where `cors` is registered, else pass it via the server options like `corsAllowedOrigins`).
- [x] 1.2 Unit tests (`packages/server/src/__tests__/` — cors/origin behavior):
  - Origin host in a `trustedNetworks` CIDR (`192.168.16.0/24`) → ACAO echoed.
  - Origin host NOT in any trusted network and not otherwise allowed → no ACAO.
  - `Origin: null` with a permissive `trustedNetworks` → still no ACAO (refusal preserved).
  - Empty `trustedNetworks` → behavior identical to today (loopback/tunnel/shell/configured only).
  - Wildcard (`192.168.*.*`) and exact-IP trusted entries both match.

## 2. Electron remote attach — probe in main, navigate in renderer (surface 1)

- [x] 2.1 Expose a main-process reachability probe to the loading page. Add `probeServer(url: string): Promise<{ ok: boolean; version?: string; reason?: string }>` to the main preload bridge (`piDashboard` namespace) backed by an `ipcMain.handle("dashboard:probe-server", …)` that calls the existing `probeRemote` in `remote-connect-window.ts` (extract `probeRemote` to a shared module if importing it into `main` is awkward).
- [x] 2.2 In `loading.html`'s `tryConnect`, when `window.piDashboard?.probeServer` exists AND `serverUrl` is a **non-loopback** URL, await `piDashboard.probeServer(serverUrl)` instead of the renderer `fetch`. On `ok`, `location.href = serverUrl`. On not-ok, keep the existing retry + `showError()` timing.
  - Fallback: if the IPC is unavailable (older preload), retain the current renderer `fetch` path so local/loopback attach is unchanged.
  - Do NOT change the known-servers buttons (`loading.html:97`) — they already navigate directly.
- [x] 2.3 Verify the remote-attach startup path (`main.ts` remote block) still calls `createMainWindow(remoteUrl)` + `showLoadingPage(win, remoteUrl)`; the fix lives entirely in how the loading page decides to navigate, so no startup-arm restructure is needed.
- [x] 2.4 Tests: unit-test the extracted `probeRemote` (already testable — Node fetch with timeout: ok / non-200 / abort → `Timed out` / network → `Connection refused`). Add a `loading.html` logic test if the page's script is factored into a testable module; otherwise cover via the Electron smoke in §5.

## 3. Web transactional switch — surface 2 UI

> **§3.1–3.3 (WS-ticket minting) DROPPED during implementation.** The premise
> — that a cross-origin `/ws` switch requires a minted ticket — is contradicted
> by the server: both WS-upgrade gates short-circuit on a **trusted source IP
> BEFORE the ticket check** (`server.ts:1786-1790` no-auth branch;
> `validateWsUpgrade` `auth-plugin.ts:332` auth branch). For the trusted-network
> LAN-to-LAN scenario this change targets, the ticketless staging + committed
> sockets already pass; the sole web-path blocker was the CORS probe, fixed in
> §1. In the non-trusted case, `mintWsTicket` itself goes through `networkGuard`
> (same trusted-IP/cookie/bearer requirement) and would fail too — so the ticket
> is unreachable dead weight. Dropping it per Simplicity-First. User-confirmed.
> Proposal / design / server-selector spec updated to match.

- [x] ~~3.1 `mintWsTicket` helper~~ — DROPPED (trusted-IP short-circuits the ticket; unnecessary).
- [x] ~~3.2 `performServerSwitch` mints + carries a ticket~~ — DROPPED (ticketless socket already passes via trusted IP).
- [x] ~~3.3 committed connection carries a ticket~~ — DROPPED (same reason; a single-use ticket would also break auto-reconnect).
- [x] 3.4 In `ServerSelector.tsx` probe handler, distinguish an **opaque/blocked** cross-origin failure (the `.catch()` transport path where no response was readable) from a genuine unreachable: added a `cors-blocked` `ProbeState` + an `isLanHost` predicate (RFC-1918 / CGNAT / link-local / `.local`) as the client-observable proxy for a trusted-network candidate; a `.catch()` on a LAN host renders "CORS-blocked — allowlist this origin on the remote" (amber, disabled, `data-cors-blocked`) instead of "Unreachable". Existing `403 network_not_allowed` → "Network not allowed" and non-LAN transport-failure → "Unreachable" branches preserved.
- [x] 3.5 Tests:
  - `isLanHost` unit: RFC-1918 / CGNAT / link-local / `.local` true; public IPs + boundary cases (172.15/172.32/100.128) + DNS names false (`server-selector.test.ts`).
  - `ServerSelector` component: a LAN-IP known server whose probe `.catch()`es renders "CORS-blocked" + `data-cors-blocked`, disabled; existing localhost → "Unreachable" preserved (`ServerSelector.test.tsx`).
  - (ticket-switch tests dropped with §3.1–3.3.)

## 4. Cross-cutting verification

- [x] 4.1 `npm test` — all changed test files green in isolation (server cors 18, electron remote-probe 9, client server-selector+ServerSelector 26). Full-suite reds are pre-existing/flaky and outside this diff: `pi-image-fit-extension` (`Jimp is not a constructor`, untouched package) + server-startup timeouts under full-suite load (all pass in isolation) + flaky `doctor-route` (passes/fails nondeterministically, not in diff).
- [x] 4.2 `quality:changed`: `tsc --noEmit` clean for this diff (only pre-existing image-fit/Jimp type errors remain). Biome import-sort errors on `server.ts`/`main.ts`/`ServerSelector.tsx` are **pre-existing** (identical counts at BASE via stash-verify); this diff introduced **zero** new Biome violations. The 3 new files (`cors-origin.ts`, `remote-probe.ts`, `remote-probe.test.ts`) are fully clean.

## 5. Validate (manual, against a real LAN remote)

- [x] 5.1 On a second machine, run the dashboard and add the first machine's network to `trustedNetworks`. Confirm `curl -H "Origin: http://<lan-ip>:8000" http://<lan-ip>:8000/api/health` now returns `access-control-allow-origin`.
- [x] 5.2 Web: from a browser tab served by server A, open the header dropdown, pick server B (trusted-network LAN remote). Confirm the row is NOT disabled, the switch commits (staging socket opens, sessions rehydrate), and no state loss on the live connection.
- [x] 5.3 Web negative: pick a LAN remote whose network is NOT trusted → row shows the new "CORS-blocked — allowlist this origin" hint (not a bare "Unreachable"), and switching is blocked.
- [x] 5.4 Electron: "Connect to Remote Dashboard" → enter `http://<lan-ip>:8000` → Test Connection OK → Connect → app relaunches and **attaches to the remote dashboard** (no ~15 s hang, no error page) with the remote's sessions visible.
- [x] 5.5 Electron regression: local (standalone) launch still shows the loading page and attaches to `http://localhost:<port>` exactly as before.
- [x] 5.6 Security check: confirm `Origin: null` to `/api/health` still returns NO `access-control-allow-origin` even with a permissive `trustedNetworks` (the intentional refusal is intact).
