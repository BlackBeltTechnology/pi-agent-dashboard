## Why

GitHub issue #625 (CE2Sec, CVSS 9.6) reports an unauthenticated Cross-Site WebSocket Hijacking (CSWSH) → RCE against the default install (no OAuth). Verified against `develop`: the `upgrade` handler in `packages/server/src/server.ts` admits any loopback peer via `isGenuinelyLocal`, and a browser-dialled WebSocket from *any* website is a loopback peer. No `Origin` check exists on the WS path (the comment at the handler claims one as "defense-in-depth" — it was never implemented). An attacker page can open `/ws`, receive `sessions_snapshot`, send `create_terminal`, learn the id from the `terminal_added` broadcast, dial `/ws/terminal/<id>`, and drive an interactive PTY as the desktop user. The same report notes body-less `POST /api/*` mutations (`/api/tunnel-connect`, `/api/pi-core/update`, …) are blind-CSRF-able because CORS gates only response *reads*, not request delivery.

## What Changes

- **WS upgrade Origin gate.** Every WebSocket upgrade on the dashboard listener — every path, including `/ws/bridge` and unmatched paths — SHALL reject a *present* `Origin` that is not admitted, with `HTTP/1.1 403`. Admission = the CORS allow-decision (`packages/server/src/auth/cors-origin.ts`) plus same-origin-by-Host-match, minus the blanket `*.share.zrok.io` wildcard (a stranger's free zrok share must not pass). Absent `Origin` (non-browser local clients: bridge, CLI, skill) stays allowed. Runs first in the handler, regardless of `authConfig.secret` — before, not instead of, the existing cookie/ticket/local-token/trusted-network gate.
- **pi-gateway Origin gate.** The pi-gateway TCP WebSocket listener (`packages/server/src/pi/pi-gateway.ts` `verifyClient` → `decideBridgeUpgrade`) SHALL reject any upgrade carrying *any* `Origin` header. No browser is ever a legitimate bridge peer, so presence alone is the signal; the tokenless-loopback deprecation grace no longer admits a browser dial. Unix-socket peers unchanged.
- **`live` scope exception.** `/live/:id` upgrades additionally allow `Origin: null` — the sandboxed opaque-origin preview iframe (`live-server-preview`, `sandbox="allow-scripts"` without `allow-same-origin`) is the *intended* client of that proxy and always presents `null`. `browser` and `terminal` scopes reject `null`.
- **Mutating REST Origin gate.** A Fastify `onRequest` hook on `/api/*` and `/auth/logout` SHALL reject non-`GET`/`HEAD`/`OPTIONS` requests carrying a *present* `Origin` that is not admitted (same admission rule as above; `null` is never admitted) with `403`. Closes the blind-CSRF primitive without per-route changes (`/v1/*` model-proxy POSTs already require an API key and are out of scope). Same-origin dashboard POSTs (loopback / Host-matching hostname / tunnel / configured / trusted-network origin), the `pi-dashboard.dev` shell's pairing calls, and header-less non-browser clients are unaffected.
- **Shared helper.** One pure function (e.g. `isOriginTrusted(origin, scope, opts)` in `auth/cors-origin.ts` or a sibling) backs both gates, unit-tested against the real implementation — no hand-mirrored copy.
- **Observability.** Rejections log one line (`[ws-gate] rejected upgrade origin=<o> scope=<s>` / `[csrf-gate] rejected <method> <url> origin=<o>`) so a hijack attempt is visible in `server.log`.
- **Spec correction.** `dashboard-server` scenario *"Localhost WebSocket upgrade — no check"* is no longer true and is replaced.

Out of scope (recorded as rejected alternatives in `design.md`): a per-session WS token in no-OAuth mode; scoping `terminal_added` broadcasts to the originating client; UI confirmation before `create_terminal`. Once a hostile origin cannot complete the upgrade, none of those add protection against the reported vector, and each would touch the multi-tab UI contract.

## Capabilities

### New Capabilities
- `cross-site-request-gate`: Origin-based admission for WebSocket upgrades (per route scope, `null` handling) and for mutating `/api/*` requests; shared decision helper; rejection logging.

### Modified Capabilities
- `dashboard-server`: *WebSocket upgrade auth check* — the "Localhost WebSocket upgrade — no check" scenario becomes "Localhost upgrade with untrusted Origin is rejected"; localhost upgrades without an `Origin` header still skip cookie validation.

## Impact

- `packages/server/src/server.ts` — upgrade handler (`fastify.server.on("upgrade")`), new `onRequest` hook registration for `/api/*`.
- `packages/server/src/auth/cors-origin.ts` (or new sibling) — shared origin-trust helper; `packages/server/src/auth/AGENTS.md` row.
- `packages/server/src/pi/bridge-upgrade-auth.ts` — `decideBridgeUpgrade` gains the Origin-presence refusal (pure, already unit-tested in `__tests__/bridge-upgrade-auth.test.ts`).
- Tests: `packages/server/src/__tests__/ws-upgrade-routing.test.ts` pattern (real server + real upgrade handler) for the WS gate; `packages/server/src/__tests__/cors.test.ts` pattern for the pure helper; `__tests__/bridge-upgrade-auth.test.ts` for the pi-gateway rule; new test for the REST hook using `fastify.inject`.
- Clients unaffected: Electron loads `http://localhost:<port>` (loopback origin, allowed); Vite dev at `http://localhost:5173` (loopback, allowed); tunnel origins already in the CORS allow set; bridge / CLI / skills send no `Origin`.
- Behavioral risk: a browser client on an origin that is neither CORS-allowed nor same-origin-by-Host is now refused WS and mutations. Known case: a zrok share started by hand outside the dashboard's tunnel feature — add it to `cors.allowedOrigins` (release-note). DNS rebinding remains open as it is today; Host allow-listing is a follow-up change.
- Docs: `docs/architecture.md` (or the security section it points to) gains a paragraph on the two gates; issue #625 gets a response. Release note as a security fix; consider a GHSA advisory.

## Discipline Skills

- `security-hardening` — untrusted-input admission gate on WS and REST; threat model is the #625 attack chain.
- `doubt-driven-review` — before landing: Origin-only vs. Origin+token decision, and the `null`-origin allowance on the `live` scope (is the opaque-iframe carve-out exploitable via an attacker's own sandboxed iframe? it only reaches the user's own preview dev server by known id, which is already loopback-reachable).
- `observability-instrumentation` — rejection log lines are the only runtime evidence of an attempted hijack.
