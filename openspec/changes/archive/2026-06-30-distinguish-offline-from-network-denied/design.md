## Context

GitHub issue #99 remote screenshots. Accessing the dashboard from a different LAN machine conflates three states into one red "broken" experience. The server is actually reachable (`/api/health` is ungated → 200 remotely), but guarded endpoints (`/api/browse`, sessions, etc. via `createNetworkGuard`) return a bare `403 "Access denied"`, and the selector shows a phantom `localhost` row that probes the *browser's* machine. The user cannot distinguish "offline" from "not permitted".

## Goals

- Remote clients never see a phantom `localhost` "Local" entry.
- A network-guard refusal is presented as "Network not allowed" with a remedy, not "offline" / "Access denied".
- A genuine transport outage still presents as the existing "Disconnected / Retrying" banner.

## Non-Goals

- The intermittent remote WebSocket drop ("Server offline" in images 3/4) — needs a runtime repro; tracked separately.
- Changing the security model. `trustedNetworks` + auth gating stays; only the *legibility* of a denial improves.
- Auto-trusting networks without explicit user action.

## Decisions

### Machine-readable error contract
The guard 403 body gains `error: "network_not_allowed"` (stable literal) plus human `reason` + `hint`. Clients branch on the literal, never on prose. This is the linchpin that lets every client surface (selector, banner, PathPicker) tell denial from outage with one check.

### Reachability signal kept (health ungated)
`/api/health` stays ungated deliberately — it is precisely what lets the client prove "server up, network denied" rather than "server down". Do not gate it.

### Loopback-origin seed gate
Seed `localhost` only when `window.location.hostname` ∈ {localhost, 127.0.0.1, ::1}. For remote origins the served host is the operative entry; a `localhost` probe from the browser is meaningless and actively misleading.

## Open question driving sequencing (task 1.1)

Issue #99 shows "Credentials configured ✓" yet "Access denied" on browse. Before building the client "Network not allowed" branch, confirm whether `request.isAuthenticated` is actually set for `/api/browse` calls. Two possibilities:
- Auth applies only to the page shell / WS upgrade, not REST calls → a real auth-plumbing gap; the denial is "correct" only because auth never reached the guard. Fixing that may be the true remedy and could shrink the client work.
- Auth applies but the user's credentials weren't sent (cookie scope / cross-origin) → the hint should steer toward re-auth.

Resolve this first; it determines whether the primary fix is server auth-plumbing or client legibility (likely both, but the emphasis shifts).

## Resolved questions

### 1.1 — Is `request.isAuthenticated` set for `/api/browse`? (auth-plumbing finding)
Yes, when auth is enabled and a valid JWT cookie is present. The auth `onRequest` hook (`packages/server/src/auth-plugin.ts:246`) runs for every non-loopback request except `/api/health`, `/auth/*`, `/v1/*`, and configured bypass URL/host prefixes — `/api/browse` is covered. A same-origin `fetch` sends the cookie, the hook verifies it, and sets `(request as any).isAuthenticated = true` before the `createNetworkGuard` preHandler runs. So the guard correctly passes authenticated browse calls.

Key sequencing detail: when auth is **enabled** and the request is **unauthenticated** (no/invalid cookie) with a non-HTML `Accept`, the hook returns `401 { error: "Authentication required" }` and the request **never reaches** the network guard. The guard's `403` is therefore only emitted when **auth is disabled** (the `onRequest` 401 gate is absent) and the source IP is not loopback / not in `trustedNetworks`.

Conclusion: issue #99's bare `403 "Access denied"` is a guard denial under an **auth-disabled** deployment, not an auth-plumbing gap. The true remedy is adding the client subnet to `trustedNetworks` (or enabling + signing into auth). No server auth-plumbing change is needed; the work is client legibility + a self-describing 403. (`Credentials configured` in the UI does not imply a valid browser session cookie was present on the remote machine.)

### 1.2 — Denial-surface affordance: inline "Trust this network" vs deep-link
Deep-link to Settings → Servers only. An inline `trustedNetworks` write would need a new mutate endpoint and bypass the "no auto-trusting without explicit user action" non-goal. Keep the surface a navigational affordance to where `trustedNetworks` is edited; user makes the change deliberately.

### 1.3 — Error literal + copy strings (confirmed)
- `error`: `"network_not_allowed"` (stable machine-readable literal; clients branch on this).
- `reason`: `"Source IP not loopback, not in trustedNetworks, and request not authenticated."`
- `hint`: `"Add this network to trustedNetworks (Settings → Servers) or sign in."`

## Risks

- **Breaking string-match consumers.** Any test or code matching the old `"Access denied"` body breaks — internal only; grep and update (task 2.3).
- **Over-trusting the hint.** The hint must not leak whether a specific network exists or imply a bypass; keep copy generic ("add your network or sign in").
