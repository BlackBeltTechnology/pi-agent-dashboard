# Design — fix remote-connect CORS/origin gates on Electron and web

## Context

A LAN dashboard (`http://192.168.16.242:8000`) is reachable — an address-bar visit and a `curl`/main-process probe both succeed — yet selecting it as a **remote** fails on both surfaces. The common cause is that the request that decides "connected" is an in-app `fetch`, subject to a CORS/origin gate that a top-level navigation (or a Node/`curl` fetch, which sends no `Origin`) never faces.

The two surfaces fail for *different* origin reasons and so need coordinated but distinct fixes:

| Surface | Deciding request | Origin seen by server | Server verdict |
|---|---|---|---|
| Electron attach | `loading.html` renderer `fetch(serverUrl + "/api/health")` | `Origin: null` (`file://` `loadFile` page) | `origin === "null" → cb(null, false)` — **intentional, never relaxed** |
| Web dropdown | `ServerSelector` `fetch(...\/api/health)` | real LAN origin `http://192.168.16.242:8000` | not in allowlist → `cb(null, false)` |

Grounding (current code):
- Server CORS callback: `packages/server/src/server.ts:949-985`. Ordered branches: no-Origin→allow, `null`→deny, loopback→allow, active zrok URL→allow, `*.share.zrok.io`→allow, `https://pi-dashboard.dev`→allow, `corsAllowedOrigins.includes`→allow, else `cb(null, false)`. `config.resolvedTrustedNetworks` is already in scope (used at `:1005`, `:1026`, `:1770`). `isBypassedHost` already imported (`:54`).
- Electron loading page: `packages/electron/resources/loading.html` `tryConnect()` — renderer `fetch`, `location.href = serverUrl` only on `res.ok`; known-servers buttons already do a raw `location.href` (no fetch) and work.
- `probeRemote(url)`: `packages/electron/src/lib/remote-connect-window.ts:65` — Node `fetch` (no `Origin`), 5 s timeout, returns `{ ok, version?, reason? }`. Already the engine behind "Test Connection".
- Main preload bridge: `packages/electron/src/preload.ts` — `piDashboard` namespace (`requestLaunch`, `openDoctor`, `readServerLog`, `onStatus`).
- Web probe: `ServerSelector.tsx` `ProbeState = "available" | "unreachable" | "denied"`; `403 network_not_allowed` → `denied`, `.catch()` → `unreachable`.
- Transactional switch: `performServerSwitch` (`server-switch.ts:47`) builds `ws://host:port/ws` with **no ticket** and opens a staging socket.
- WS auth: upgrade handler `server.ts:1767-1799`. With `authConfig.secret` set, `/ws` requires cookie/bearer/**ticket**; with no auth, `/ws` is allowed for genuine-local, local-IPC token, **trusted source IP** (`isBypassedHost(remoteAddress, trusted)`), or a valid ticket. Ticket mint: `POST /api/ws-ticket { scope }` behind `networkGuard` (`server.ts:1304`); scopes `browser|terminal|editor|live`; single-use, 15 s TTL; carried as `?ticket=<t>` or `pi-ticket.<t>` subprotocol (`ws-ticket.ts`).

## Goals / Non-Goals

**Goals:**
- Electron "Connect to Remote Dashboard" attaches to a reachable LAN remote instead of hanging ~15 s then erroring.
- Web header dropdown connects to a trusted-network LAN remote instead of rendering a disabled "Unreachable" row.
- Widen CORS only to networks the operator has **already trusted** (`trustedNetworks`); no new config key.
- Preserve every existing security posture: `null`-origin refusal, unknown-origin rejection, bearer/ticket auth, single-use ticket scope binding.

**Non-Goals:**
- Relaxing the `null`-origin CORS rule (the Electron fix routes *around* it, never through it).
- The caller-initiated "request access → approve → issue key" pairing handshake (separate, larger design on `pairing.ts`).
- TLS for LAN endpoints (plain-http LAN posture matches accepted `add-tunnel-providers` model).
- Changing the `KnownServer` model, mDNS discovery, or the staging-socket transaction shape (`safe-server-switch` stands).

## Decisions

### Decision 1 — Server CORS: add a trusted-network branch, change nothing else

**Choice**: In the `@fastify/cors` `origin` callback, insert ONE branch after the configured-origins check and BEFORE the final `cb(null, false)`:

```
// origin already parsed to `host` above (inside the existing try)
if (resolvedTrustedNetworks.length > 0 && isBypassedHost(host, resolvedTrustedNetworks))
  return cb(null, true);
```

Placement is inside the existing `try { const u = new URL(origin); const host = u.hostname; … }` block so a malformed origin still falls through to deny. The `null` branch (`:957`) and the terminal `cb(null, false)` (`:982`) are untouched.

**Why host-match, not a new allowlist**: `isBypassedHost` already backs the WS-upgrade trust decision for the *same* networks (`server.ts:1788`). Reusing it makes "may this origin READ a response" and "is this source IP a trusted network" the same predicate, so an operator adds a network to `trustedNetworks` **once** and both the auth bypass and the CORS read-allowance follow. Hand-editing `cors.allowedOrigins` per remote is the status-quo failure mode this removes.

**Alternative rejected**: derive allowed origins by reflecting any `Origin` whose host resolves to a private RFC-1918 range. Rejected — it would trust LAN peers the operator never opted into, decoupling CORS from the `trustedNetworks` gate that governs auth. Trust must stay a single operator decision.

**Security invariant**: CORS controls who may *read* a cross-origin response; it grants no authority. Auth (bearer/ticket/trusted-IP) is unchanged and still gates every mutation. Widening reads to already-trusted networks weakens nothing that auth protected.

### Decision 2 — Electron: probe in main, navigate in renderer (never fetch from `null`)

**Choice**: The `null`-origin fetch in `loading.html` cannot be fixed server-side (the refusal is deliberate), so eliminate the fetch on the remote path. Expose the existing `probeRemote` to the loading page over IPC and let the renderer do a CORS-free top-level navigation:

1. Add `probeServer(url): Promise<{ ok; version?; reason? }>` to the `piDashboard` preload bridge, backed by `ipcMain.handle("dashboard:probe-server", …)` → `probeRemote(url)`. Extract `probeRemote` to a shared module if importing `remote-connect-window.ts` into `main` pulls in `BrowserWindow` side-effects.
2. In `tryConnect()`: when `window.piDashboard?.probeServer` exists AND `serverUrl` is **non-loopback**, `await piDashboard.probeServer(serverUrl)`; on `ok`, `location.href = serverUrl` (top-level nav, no `Origin`, no CORS). On not-ok, keep the existing retry cadence + `showError()` at attempt 10.
3. **Fallback**: if the IPC is absent (older preload) OR `serverUrl` is loopback, retain today's renderer `fetch` path. Local/standalone attach is byte-for-byte unchanged.

**Why the main process is the right prober**: `probeRemote` is Node `fetch` — it sends no `Origin` header (like `curl`, like "Test Connection" which already works). The renderer only decides *when* to navigate; it never issues the reachability request. This is why "Test Connection" succeeds but the post-relaunch attach hangs today — the fix moves the attach decision onto the same code path Test Connection already uses.

**Why not relax `null` server-side**: `Origin: null` covers sandboxed live-server iframes that must not reach dashboard APIs (`improve-content-editor` §6.5). Relaxing it to unblock our own loading page would also unblock untrusted embedded content. Off the table.

**No startup-arm restructure**: `main.ts` still calls `createMainWindow(remoteUrl)` + `showLoadingPage(win, remoteUrl)` (`:518-520`). The entire change lives in how the loading page *decides to navigate*.

### Decision 3 — Web switch: CORS is the only enabler; drop the WS ticket; refine the UI

**Revised during implementation (user-confirmed).** The web fix reduces to CORS
(Decision 1) plus a UI refinement. The originally-planned WS-ticket minting was
dropped after tracing the server's WS-upgrade auth.

**3a — CORS enables both the probe AND the sockets.** Once Decision 1 ships,
`ServerSelector`'s cross-origin `fetch(...\/api/health)` to a trusted-network
remote gets an `Access-Control-Allow-Origin` header, so the browser exposes the
response and the row leaves the dead `.catch()` → "Unreachable" state. The
same trusted-network trust then admits the switch's sockets (3b).

**3b — No WS ticket (dropped).** The draft assumed `performServerSwitch`'s
ticketless `ws://host:port/ws` (`server-switch.ts:47`) would be refused and had
to mint a target-scoped ticket. Tracing the upgrade path disproves this: **both
gates short-circuit on a trusted source IP before the ticket is ever checked** —
the no-auth branch (`server.ts:1786-1790`: `… && (trusted.length === 0 ||
!isBypassedHost(remoteAddress, trusted)) && !(scope && ticket && …)` — a trusted
IP makes the whole `&&` false) and the auth branch (`validateWsUpgrade`,
`auth-plugin.ts:332`: `if (trustedNetworks.length > 0 &&
isBypassedHost(remoteAddress, trustedNetworks)) return true;`, before the ticket
clause). So for the trusted-network LAN-to-LAN scenario this change targets, the
ticketless staging + committed sockets already pass. In the non-trusted case,
`mintWsTicket` itself runs behind `networkGuard` (same trusted-IP/cookie/bearer
gate) and would fail too — cross-origin there's no cookie — so the ticket is
unreachable dead weight. It also could not have been a single-use ticket baked
into the committed URL without breaking `useWebSocket`'s auto-reconnect (each
reconnect reuses the same consumed ticket). Dropped per Simplicity-First; the
trusted-IP path is the real authority and it already works.

**3c — CORS-blocked ≠ unreachable in the UI (kept).** The browser cannot
distinguish a CORS block from connection-refused (both throw an opaque
`TypeError` with no readable response). Add a `cors-blocked` `ProbeState` and an
`isLanHost(host)` predicate — private-address literals (RFC-1918, CGNAT
`100.64/10`, link-local `169.254/16`, mDNS `.local`) — as the client-observable
proxy for a trusted-network candidate. On the probe `.catch()` path: LAN host →
`cors-blocked` (amber "CORS-blocked — allowlist this origin on the remote",
disabled, `data-cors-blocked`); non-LAN host → `unreachable` (unchanged). The
existing `403 network_not_allowed` → "Network not allowed" branch is preserved.
This turns a silent dead row into an actionable instruction for the not-yet-
trusted case.

## Risks / Trade-offs

- **Widened CORS surface.** Mitigated: allowance is gated on `trustedNetworks`, an existing operator opt-in; empty `trustedNetworks` → behavior identical to today. CORS grants reads only; auth still gates writes.
- **CORS-blocked heuristic is a proxy, not proof.** `isLanHost` can only guess a trusted-network candidate from a private-address literal; a genuinely-offline LAN box also shows "CORS-blocked". Acceptable — the browser cannot tell the two apart, and "allowlist this origin" is harmless advice either way (a down host stays disabled). A public-IP outage still reads "Unreachable", unchanged.
- **IPC-absent Electron fallback** keeps the `null`-origin fetch path alive for loopback, which is fine (loopback origin is CORS-allowed) but means the remote fix depends on the new preload shipping together with the new `loading.html`. Both are in-repo resources bundled in the same build — no version skew across a boundary.
- **Web path depends entirely on Decision 1.** With no trusted-network CORS branch the probe stays blocked and the row stays dead. Decision 1 is the sole server-side enabler; Decision 3c is a pure UI refinement on top.

## Migration / Rollout

- No config migration. Operators who want a remote reachable add its network to `trustedNetworks` — which they already do to bypass auth for that network. No `cors.allowedOrigins` hand-editing.
- Ships as one change (server + electron + client) because surface 2 (web) needs the server CORS branch to function; splitting would land a client that still shows dead rows.

## Verification hooks

- Server: unit tests assert ACAO echoed for a `trustedNetworks`-CIDR origin, absent for an untrusted origin, absent for `Origin: null` even with permissive `trustedNetworks`, and byte-identical behavior when `trustedNetworks` is empty (tasks §1.2).
- Electron: unit-test `probeRemote` (ok / non-200 / abort / network) (tasks §2.4).
- Client: `isLanHost` unit cases (RFC-1918 / CGNAT / link-local / `.local` true; public + boundary + DNS false); `ServerSelector` probe `.catch()` on a LAN host → "CORS-blocked" + `data-cors-blocked` + disabled, non-LAN → "Unreachable" (tasks §3.5). `server-switch.ts` / `staging-socket.ts` unchanged (no ticket).
- Manual: `curl -H "Origin: http://<lan-ip>:8000" http://<lan-ip>:8000/api/health` returns ACAO once trusted; `Origin: null` still does not; Electron attach + web switch complete against a live LAN remote (tasks §5).
