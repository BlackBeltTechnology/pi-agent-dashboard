# Fix remote-connect: CORS/origin gates block LAN remotes on both Electron and web

## Why

A dashboard running on a LAN host (e.g. `http://192.168.16.242:8000`) is reachable — a browser address-bar visit and a `curl`/main-process probe both work — yet **selecting it as a "remote" fails to connect on both surfaces**. Root cause on each is an *origin*-based CORS gate that a top-level navigation is never subject to but an in-app `fetch` is. The two surfaces fail for origin-different reasons, so they need two coordinated fixes shipped together.

Empirically confirmed against a live `0.5.4` server:

| Request origin | Server returns `Access-Control-Allow-Origin`? |
|---|---|
| `Origin: null` (a `file://` `loadFile` page — the Electron loading page) | **no** (CORS callback's `origin === "null" → cb(null, false)`) |
| `Origin: http://localhost:8000` (loopback) | yes |
| `Origin: http://192.168.16.242:8000` (LAN) | **no** (LAN origins are not in the allowlist) |

### Surface 1 — Electron remote attach hangs

Startup remote-mode attach calls `createMainWindow(remoteUrl)` (a working top-level `loadURL`) and then **overrides it** with `showLoadingPage(win, remoteUrl)`, a `file://` `loadFile` page. That page (`loading.html`) gates the redirect behind a renderer `fetch(serverUrl + "/api/health")`:

```js
const res = await fetch(serverUrl + "/api/health", { signal: AbortSignal.timeout(2000) });
if (res.ok) { location.href = serverUrl; return; }   // ← only navigates if the CORS-bound fetch passes
...
setTimeout(tryConnect, 1500);   // retries; showError() after ~15 s
```

The loading page's origin is `null` (a `file://` document). The server **deliberately** refuses `Origin: null` (a security decision for sandboxed live-server iframes — `live-server-preview` spec). So `res.ok` is never reached, the redirect never fires, and the attach shows an error after ~15 s **even though the server is healthy and directly reachable**. This is why "Test Connection" succeeds (main-process Node fetch sends no `Origin` header, like `curl`) but the post-relaunch attach hangs. **Server-side CORS changes cannot fix this** — `null` is intentionally denied — so the fix is client-side: probe reachability in the main process (reusing the already-working `probeRemote`), and let the renderer perform the CORS-free top-level navigation.

### Surface 2 — Web dropdown "remote" is dead

The header `ServerSelector` probes each remote entry with a cross-origin `fetch(...\/api\/health)` (`ServerSelector.tsx:123`). For a LAN remote the page's origin is a real http LAN origin (e.g. `http://192.168.16.242:8000`), which the server's CORS allowlist does not include → no `Access-Control-Allow-Origin` → the browser discards the response → `.catch()` → the row renders **"Unreachable"** and is **disabled** (can't even click). Unlike the Electron case, this origin is a *real* origin, so a **server-side allowlist of LAN/trusted-network origins does fix the probe**. Past that, the transactional switch opens a staging `WebSocket` to `ws://<remote>/ws` (`server-switch.ts:47`), and `/ws` requires a **single-use ticket** minted via an authenticated REST call (`ws-ticket.ts`); the staging socket currently carries no ticket, and minting one cross-origin is itself a CORS-bound read. So the web fix is: (a) allow trusted-network origins in CORS, and (b) make the client mint + carry a ticket against the *target* server for the staging and committed sockets.

### Relationship to existing work

- **`server-cors` spec** currently allows only loopback + active tunnel + `*.share.zrok.io` + `pi-dashboard.dev` + configured `cors.allowedOrigins`. It has no private-LAN branch. This change adds a trusted-network branch.
- **`add-tunnel-providers`** (active) owns *advertising* LAN endpoints + the `trustedNetworks` CIDR model and the accepted "plain-http LAN, bearer governed by `trustedNetworks`" posture. This change reuses its `isBypassedHost` matcher and cites that posture; it does not conflict (tunnel-providers advertises endpoints; this change makes cross-origin *switching between* them work).
- The `null`-origin refusal in `server-cors` (from `improve-content-editor` / `live-server-preview`) is **preserved** — the Electron fix deliberately does NOT relax it.

## What Changes

- **Server CORS (surface 2 enabler).** Extend the `@fastify/cors` origin callback so an origin whose **host** matches `config.resolvedTrustedNetworks` (exact IP / CIDR / wildcard, via the existing `isBypassedHost`) is allowed, in addition to the current loopback/tunnel/shell/configured set. The `Origin: null` refusal and the "unknown origin → `cb(null, false)`" behavior are unchanged. CORS (who may READ a response) stays distinct from auth (bearer/ticket).
- **Electron remote attach (surface 1).** Add a main-process reachability probe exposed to the loading page via IPC (`piDashboard.probeServer(url)`) reusing `probeRemote` (Node fetch, no `Origin`, no CORS). `loading.html`'s `tryConnect` awaits that IPC instead of a renderer `fetch` when a `serverUrl` is a remote (non-loopback) URL, then performs the CORS-free `location.href = serverUrl`. The known-servers buttons (already a raw `location.href`, `loading.html:97`) are unaffected. Local attach behavior is unchanged.
- **Web transactional switch (surface 2).** The `ServerSelector` probe and `performServerSwitch` staging/committed sockets mint and carry a WS ticket against the **target** server (query param or `pi-ticket.<t>` subprotocol per `ws-ticket.ts`). A cross-origin probe that yields an **opaque/blocked** response (no readable status) is surfaced distinctly from a genuine transport-unreachable, with a hint that the remote must allowlist this origin — instead of a dead "Unreachable" row.

## Capabilities

### Modified Capabilities

- `server-cors`: ADDS a requirement that origins whose host matches a configured trusted network are CORS-allowed (LAN-to-LAN switching), while preserving the `null`-origin refusal and unknown-origin rejection.
- `electron-shell`: ADDS a requirement that the remote-mode attach checks reachability in the **main process** and performs a top-level navigation in the renderer — it SHALL NOT gate the navigation behind a `null`-origin renderer `fetch` (the current hang).
- `server-selector`: ADDS requirements that (a) a cross-origin/opaque probe failure is distinguished from transport-unreachable with an allowlist hint, and (b) the staging + committed switch sockets carry a WS ticket minted against the target server, so switching to a trusted-network remote succeeds.

## Impact

- **User-visible:** Electron "Connect to Remote Dashboard" attaches instead of hanging ~15 s then erroring; the web header dropdown connects to a LAN remote instead of showing a disabled "Unreachable" row.
- **Config:** no new config keys. LAN-origin allowance is derived from the existing `trustedNetworks` — a host must already be trusted for its origin to be CORS-allowed. Operators who want a remote reachable add its network to `trustedNetworks` (which they already do for auth bypass), rather than hand-editing `cors.allowedOrigins`.
- **Security:** CORS allowance is widened only to already-trusted networks; the `null`-origin refusal, unknown-origin rejection, and bearer/ticket auth all stand. Plain-http LAN bearer/ticket-in-clear posture matches the accepted `add-tunnel-providers` LAN model.
- **Files (approx):** `packages/server/src/server.ts` (CORS callback + trusted-network branch); `packages/electron/src/lib/remote-connect-window.ts` or a shared probe + `preload/*` + `main` IPC + `loading.html`; `packages/client/src/components/ServerSelector.tsx`, `lib/server-switch.ts`, `lib/staging-socket.ts` (+ a ticket-mint helper).
- **Out of scope:** the caller-initiated "request access / approve → issue key" pairing handshake (a separate, larger design that builds on `pairing.ts`); relaxing the `null`-origin CORS rule; TLS for LAN endpoints.

## Discipline Skills

- `security-hardening`: this change widens a CORS allowlist and touches cross-origin auth/ticket flows on untrusted-network input — the trusted-network gate, the preserved `null`-origin refusal, and ticket-scope binding must be verified against origin-spoofing and unauthorized-switch abuse.
