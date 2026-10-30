## Why

The security map (`docs/security/residual-risks.md`) lists five HTTP/credential findings
that sit on the same trust boundaries: who counts as "the operator" for an
HTTP request, and how long a session credential lives. Each was re-verified at
HEAD `109f2e197` (evidence `/tmp/secmap/batch2/VERIFY-AB.md`); the scopes below
are the verified ones, not the register's original wording.

- **HTTP-02 (re-rated High).** Any page on `http://localhost:<any port>` in the
  operator's browser is CORS-readable with credentials
  (`packages/server/src/auth/cors-origin.ts:177-179`, `server.ts:2341-2345`) and
  passes the mutation-origin and WS-origin gates (`auth/mutation-origin-gate.ts:47`,
  `cors-origin.ts:292-310`). Under the default strict mode the browser also sends the
  `pi_dash_local` cookie to `:8000` — SameSite and cookie scoping ignore ports —
  and the cookie is port-bound to the *dashboard's* port (`auth/local-proof.ts:92`),
  so it verifies: the page acts as a genuine-local `operate` caller. The agent can
  plant such a page (`serve_mockup`, NET-02, in the sibling change
  `close-local-listener-and-egress-gaps`) and hand the URL to the human.
- **HTTP-05 (Medium, non-default).** In `legacy` trust mode a peer inside a trusted
  network with **no credential** passes `networkGuard` and is not a tiered credential,
  so it runs at full `operate` on `/api/*` (`auth/localhost-guard.ts:459-465`,
  `auth/route-tier-gate.ts:71-74,85`). `legacy` is chosen on upgrade (a non-loopback
  trusted entry), by an operator, or when the config is unparseable
  (`auth/trust-mode-boot.ts:64-76`).
- **HTTP-04 (Medium, non-default).** With identity enforced and **no host policy**,
  any principal a trusted resolver claims gets `operate`-equivalent access on every
  non-session road: the tier gate ignores `authVia="principal"`
  (`route-tier-gate.ts:71-74`), the road gate returns early
  (`identity/identity-road-gate.ts:60`), and `hasOperateAuthority` is true
  (`auth/operate-required.ts:55`).
- **HTTP-03 (Low).** `DELETE /api/config/auth/providers/:id` is `control`
  (`packages/shared/src/route-tiers.ts:71`) while `PUT /api/config` is `operate`
  (`route-tiers.ts:514`); a `control` caller can delete every provider with
  `?force=true` and lock remote login out. The route's comment and the shipped spec
  both say "same guard as `PUT /api/config`" (`routes/system-routes.ts:817-824`).
- **CRED-03 / HTTP-06 (Low).** The OAuth/passkey session JWT (HS256, 7 d) carries no
  id and no denylist; `/auth/logout` only clears the cookie
  (`auth/auth-plugin.ts:468-473`, `auth/auth.ts:180-209`). A stolen `pi_dash_token`
  survives logout; the only kill switch is changing `auth.secret`
  (`auth/secret-rotation.ts` is a one-shot epoch with no operator command).

## What Changes

- **D1 (HTTP-02).** One loopback rule for CORS reads, the mutation gate and the WS
  gate: a loopback `Origin` is trusted only when its port is a dashboard listener port
  (`config.port`, plus the TLS listener port when enabled). Other loopback origins fall
  to `cors.allowedOrigins` or the existing origin-denial grant prompt. `CorsOriginOptions`
  gains a live `listenerPorts` input; absence fails closed. The rule covers the three
  existing loopback literals (`localhost`, `127.0.0.1`, `[::1]`, `cors-origin.ts:177-179`; no
  `127.0.0.0/8` widening) on every branch, so a `trustedNetworks` entry such as `127.0.0.1` no
  longer admits `http://127.0.0.1:<other port>` (`cors-origin.ts:204-209`). The `pi_dash_local`
  cookie is subject to this Origin gate first. *(Decision D1, confirmed by
  operator 2026-10-26.)*
- **D2 (HTTP-05).** In `legacy` mode a **network-only** admission (no credential, not
  genuine-local) is capped at `observe`: HTTP admits only observe-tier `/api/*` reads (and
  the model proxy as today), the browser WS carries socket tier `observe`, terminal and
  live-preview upgrades are refused, a port-target live-preview mint from such a peer is refused and
  capabilities minted for a network-only principal stop validating. A capped refusal keeps its
  block-event record but raises no network-grant prompt. The cap does not apply when the operator chose
  `legacy` (`trustModeOrigin: "operator"`).
  *(Decision D2, confirmed by operator 2026-10-26.)*
- **D3 (HTTP-04).** New `identity.defaultPrincipalTier` (default `control`). While identity
  is enforced and **no host policy** is registered, a claimed principal is a tiered
  credential at that tier — on REST (route-tier gate), WS messages, and the terminal/live
  upgrades. A registered host policy remains authoritative and unchanged; the break-glass
  local operator is unaffected. `hasOperateAuthority` stops treating a capped principal as
  operate. `POST /api/ws-ticket` moves to `control` with a per-scope minimum enforced in the
  handler for every tiered caller (`browser`/`live` `control`, `terminal`/`bridge` `operate`),
  and tickets record the minter's tier so the `/ws` they admit is message-gated: otherwise a
  `control`-capped principal could not open `/ws`, and lowering the row alone would hand
  `control` devices an ungated socket. *(Decision D3, confirmed by operator 2026-10-26.)*
- **D4 (CRED-03).** Server-side session revocation without a token-format change: a
  `0600` store `~/.pi/dashboard/session-revocations.json` (`notBefore` + token digests with
  expiry). `/auth/logout` revokes the presented token; `verifyToken` rejects revoked tokens
  at its single choke point (REST, status, WS upgrade, bypass helper). Operator
  "revoke all": `POST /api/auth/revoke-sessions` (`operate`) and
  `pi-dashboard revoke-sessions`, which sets `notBefore`, sweeps open session sockets and ends
  session-minted live-preview capabilities; logout also sweeps the sockets that token admitted.
  *(Decision D4, confirmed by operator 2026-10-26.)*
- **D5 (HTTP-03).** `DELETE /api/config/auth/providers/:id` becomes `operate`; MCP
  artifacts regenerated (`config_auth_providers_id` control → operate). *(Decision D5, confirmed by
  operator 2026-10-26.)*

**BREAKING** (all narrow, all with a named escape):

1. **D1 loopback origins.** A page on another loopback port (a Vite dev server calling the
   dashboard cross-origin, a second local dashboard, a custom tool) loses CORS reads and
   mutation/WS admission. Escape: list the origin in `cors.allowedOrigins` or answer the
   origin-denial prompt. Same-origin use, Vite's `/api` proxy, the neutral shell, tunnels
   and configured origins are unchanged.
2. **D2 legacy LAN peers.** Upgrade-decided `legacy` installs: LAN browsers that rely on
   network trust alone become read-only until paired. This includes **Docker users** whose
   host browser reaches the container through the Docker NAT/bridge gateway address and who
   listed that range in `trustedNetworks` (never in `pair`, which is the default for a fresh
   install). Escape: pair them (existing Settings ▸ Access banner, copy updated), switch to
   `pair`, or choose `legacy` explicitly (operator origin). The in-repo E2E harness seed
   (`docker/test-entrypoint.sh:221`) is changed to the operator form so it keeps working.
3. **D3 principals without a policy.** Enforced-identity deployments with no host policy
   lose operate-only roads (config write, terminal/exec, access/yolo, vault, paired
   devices, services mutations) for principals. Escape: register a host policy or set
   `identity.defaultPrincipalTier: "operate"` (logged at boot).
4. **D5 MCP tool tier.** `config_auth_providers_id` requires an `operate` MCP token.
5. **D4 corrupt revocation file.** A `session-revocations.json` that exists but cannot be
   read at boot sets `notBefore` to boot time: every session issued before that boot stops
   verifying (a one-time mass logout, persisted so it is not repeated). Escape: sign in
   again; an absent file is an empty store and logs nobody out.

**Compatibility note (not breaking, a widening).** Control-tier paired devices and control
sessions can now mint a `browser` ticket and open `/ws` (previously `POST /api/ws-ticket`
required `operate`); the socket is message-gated at their tier, and `terminal`/`bridge`
tickets still need `operate`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `server-cors`: MODIFIED "CORS enabled on dashboard server" (stacked on
  `add-plugin-isolation-and-public-routes`' text: localhost scenario narrows to listener
  ports), "CORS config field" (default = the dashboard's own loopback origins),
  "Trusted-network origins allowed for LAN-to-LAN switching" (a loopback-host origin is decided
  only by the listener-port rule; `trustedNetworks` never admits it, `cors-origin.ts:204-209`).
- `cross-site-request-gate`: MODIFIED "WebSocket upgrades reject untrusted Origins"
  (the "any port" parenthetical); ADDED "A loopback Origin is trusted only on a dashboard
  listener port".
- `trust-and-credential-boundaries`: MODIFIED "Opt-in local proof for loopback trust" (the
  local-proof cookie is subject to the Origin gate first; copied from the shipped text, stacked
  with `close-loopback-legacy-window`).
- `trusted-networks`: MODIFIED "Network trust mode" and "Network match does not
  authenticate in pair mode" (legacy scenarios say reads), "Network guard threaded to all
  protected routes", "Relayed loopback requests are never trusted by network entry",
  "auth.bypassHosts honored without OAuth providers" (read-only wording) and "Loopback trusted
  entries are reported as inert" (`networkOnly.refused`), "Network guard factory"
  (condition (d) is capped; stacked on `add-plugin-capability-routes`' condition (e)),
  "Access settings show the migration banner" (read-only copy), "WebSocket upgrade
  respects trusted networks" and "WebSocket upgrade admits bypassHosts trust without OAuth"
  (IP match alone no longer suffices for terminal/live in upgrade-decided legacy); ADDED "Network-only HTTP admissions are capped at observe in upgrade-decided
  legacy mode", "The legacy cap also covers WebSocket upgrades" and "The legacy cap covers
  live-preview capability mints".
- `host-access-policy`: MODIFIED "The host access policy is optional and non-session-scoped"
  and "Non-session road classification drives the policy" (no policy no longer means
  ungated for principals); ADDED "A principal without a host policy is tier-capped".
- `host-access-policy` also ADDED "The principal tier cap applies on every road".
- `oauth-authentication`: MODIFIED "Logout", "Localhost and trusted host bypass" (stacked on
  `add-plugin-capability-routes`; bypassHosts skip is not authority in upgrade-decided
  legacy); ADDED "Session JWTs are rejected once revoked", "The session revocation store is
  durable and bounded", "An operator can revoke every session", "Revocation also ends
  session-minted live-preview capabilities", "Provider deletion requires the operate tier".
- `bearer-device-auth`: MODIFIED "A device bearer's tier gates REST routes and WS-ticket
  minting" (ws-ticket row `control` + per-scope minimum; union of the two stacked deltas);
  ADDED "A WS ticket carries the tier of the caller that minted it".
- `operate-required-remedy`: MODIFIED "Operate refusals carry a reason and remedies"
  (capped principal refused by the tier gate as `insufficient_scope`; "Admission unchanged" narrowed).
- `auth-bypass-url-list`: MODIFIED "Configurable trusted hosts (auth bypass by source IP)"
  (cap narrowing). `settings-panel`: MODIFIED "Trusted Networks section on Security tab"
  (heading, wide-range and warning copy for upgrade-decided legacy).

## Impact

- Server: `auth/cors-origin.ts`, `auth/mutation-origin-gate.ts` (no change; shared
  predicate), `server.ts` (`corsOpts`, WS upgrade tier stamp, revoke route wiring),
  `auth/localhost-guard.ts`, `auth/route-tier-gate.ts`, `auth/operate-required.ts`,
  `auth/trust-mode.ts`, `auth/network-trust-telemetry.ts`, `auth/auth.ts`,
  `auth/auth-plugin.ts`, new `auth/session-revocations.ts`, `identity/resolver-hook.ts`,
  `routes/system-routes.ts` (revoke-all route), `cli.ts` (+ `revoke-sessions`),
  `auth/ws-ticket.ts` (ticket tier + session ref), `server.ts` `isPrincipalLive`
  (live-preview capability liveness), `routes/live-server-routes.ts` (`portMintRefused`).
- Docker/scripts: `docker/test-entrypoint.sh` (E2E trust seed → `network.trustMode: "legacy"`),
  `scripts/__tests__/e2e-trust-seed.test.mjs`.
- Shared: `route-tiers.ts` (DELETE row → operate; ws-ticket row → control; new revoke row),
  `ws-message-tiers.ts` (`WS_TICKET_MIN_TIER`), `config.ts`
  (`IdentityConfig.defaultPrincipalTier`), regenerated `mcp/verb-tiers.generated.ts`.
- MCP plugin: regenerated `generated/tools.ts` + README; `tools.denylist.ts` entry for the
  new revoke route.
- Client: Settings ▸ Access migration banner copy (read-only).
- Docs: `docs/security/*` register + chapters (DocScribe), README/FAQ lines.
- Migration / rollback / compatibility: see design. No data migration; the revocation
  store is additive; rollback leaves an unused file.

## Discipline Skills

- `security-hardening` — Origin trust, trust-mode tier caps, principal tier, session
  revocation, fail-closed defaults.
- `doubt-driven-review` — D1 and D2 are behaviour-breaking defaults and D4 adds a persistent
  security store (revocation file, fail-closed mass logout); review before they stand.
- `observability-instrumentation` — new log/audit lines: capped network-only refusals,
  principal-cap boot line, `session_revoked` audit.

## Ownership / not in scope

| Finding | Status | Owner |
|---|---|---|
| NET-02 `serve_mockup` binds `0.0.0.0` (the planting step for HTTP-02) | Out of scope | `close-local-listener-and-egress-gaps` |
| Cookie capture by a **server-side** process on a sibling loopback port | **Residual**: same uid can read `~/.pi/dashboard/local/token` anyway; the port-bound proof only limits replay to the dashboard port | accepted |
| `Sec-Fetch-Site` as a second layer for loopback pages | Not done (option rejected in D1) | future |
| Per-principal tier from the resolver (group → tier) | Not done; default cap only | follow-up |
| Domain-event fan-out and non-session bootstrap disclosure to a capped principal with no policy | **Residual**: unchanged (`permissioned-event-fanout`, `host-access-policy` bootstrap) — read-level data | accepted |
| WS-01 loopback grace, bridge claim/ticket findings | Out of scope | `close-loopback-legacy-window`, `harden-bridge-session-claim` |
| A caller holding a device/session credential **or an identity principal** on a listed network in `legacy` (`route-tier-gate.ts:85`), and a locally trusted principal (`:84`), are exempt from their tier via `tierRefusalFor` — D3's cap and the ws-ticket per-scope minimum do not bind them | **Residual**: needs a credential/principal; `bearer-device-auth` requirement is already stacked by two active changes | accepted; `pair` is the fix |
| A `trustedNetworks` entry covering `127.0.0.0/8` still admits `http://127.0.0.<n>:<any port>` (n ≠ 1) by the `trusted-network` branch: D1 keeps the three existing literals and adds no `127/8` allowance | **Residual**: needs an operator-written range entry; narrow it to `127.0.0.1` | accepted |
| A same-user process on `[::1]:<port>` when the dashboard is bound IPv4-only passes the loopback rule (D1 pins scheme and port, not the bind family) | **Residual**: same uid can already read the local token | accepted |
| Refused-peer telemetry shares the 256-entry peer map with admissions (a refused flood saturates `distinctPeers`) | **Residual**: telemetry only, no access effect | accepted |
| No absolute latency budget for revocation lookup, socket sweep, cap check (relative <= 5 % budget only) | **Residual** | accepted |
| `identity.defaultPrincipalTier` is frozen at boot; a runtime edit needs a restart | **Residual**: matches the frozen policy | accepted |
| Allowlist edits do not revoke already-issued sessions of allowed providers | **Residual**: only logout / revoke-all / `notBefore` revoke | `close-security-map-high-findings` D3 residual |
