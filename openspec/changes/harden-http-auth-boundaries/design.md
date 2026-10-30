## Context

All line references verified at HEAD `109f2e197` (develop). Numbering `D1…D5` matches
`/tmp/secmap/batch2/DECISIONS-A.md`; each is **confirmed by operator 2026-10-26**.

### HTTP-02 — one loopback predicate feeds three gates

- `classifyCorsOrigin` returns `allow("loopback")` for any `localhost`/`127.0.0.1`/`::1`
  origin on any port (`packages/server/src/auth/cors-origin.ts:177-179`). It is structural
  ("no configured list can revoke it", `:176`).
- `isCorsOriginAllowed` wraps it (`cors-origin.ts:225`). The same decision is reused for
  admission: `isOriginAdmitted` (`:292`) → `isWsOriginTrusted` (`:317`) and
  `isMutationOriginTrusted` (`:350`); the only deltas are the same-origin-by-Host rule
  (`isSameOriginByHost`, `:255`) and no zrok wildcard.
- CORS registration: `origin: (origin, cb) => cb(null, isCorsOriginAllowed(origin, corsOpts()))`
  with `credentials: true` (`server.ts:2342-2345`); the mutation gate is
  `createMutationOriginGate(corsOpts)` (`server.ts:2361`); `corsOpts()` is built at
  `server.ts:2162-2182`.
- A second path admits a loopback `Origin` on any port: branch 8 (`trusted-network`,
  `cors-origin.ts:204-209`) matches the origin's **host** against `trustedNetworks` via
  `isBypassedHost`, so `trustedNetworks: ["127.0.0.1"]` (or a hostname entry `localhost`)
  admits `http://127.0.0.1:<any port>`. The list is the live, **mode-independent**
  `corsTrustedNetworks()` (`server.ts:2110`, fed to `corsOpts` at `:2164`), so this holds
  in `pair` and `legacy` alike and feeds the same three gates (`server.ts:2343`, `:2361`,
  `:4840`; `auth/localhost-guard.ts:185-200` is `isBypassedHost`). The predicate must
  therefore cover the loopback literals on branch 8 as well as branch 3.
- The proof cookie is `SameSite=Strict` and bound to the dashboard's own port
  (`auth/local-proof.ts:92`, `routes/local-proof-routes.ts:56-63`). Browsers treat all
  `localhost` ports as one site and do not scope cookies by port, so a page on `:3000`
  makes the browser attach it to `:8000`; the port binding then verifies. The page cannot
  *read* the httpOnly cookie, but with the Origin gates open it needs no read: it acts
  through the browser.
- Without the cookie, a bare local caller still passes the observe-tier GET exception
  (`auth/localhost-guard.ts:444-449`), so the CORS allowance also leaks reads cross-port.
- Host admission matches the parsed hostname only, never the port (`isHostAdmitted`
  `auth/host-admission.ts:125-131` calls `classifyAdmittedHostname` `:100-118`), so a Vite dev server that proxies `/api` (no `changeOrigin`,
  `packages/client/vite.config.ts:211-217`) arrives with `Host: localhost:5173`,
  `Origin: http://localhost:5173` and is admitted by the same-origin-by-Host rule, **not**
  by the loopback allowance. That is why narrowing the loopback branch does not break the
  documented dev flow.
- The dashboard already keeps a "ports we listen on" notion: `liveServerManager` gets
  `ownPorts: () => [config.port, config.piPort, ...(tls?.enabled ? [tls.port] : [])]`
  (`server.ts:1436-1439`), with the comment that a loopback origin is trusted by the CORS and
  mutation gates.
- A refused origin is already observable and answerable: `createCorsDenialObserver` →
  `grantCoordinator.onDenial({plane:"cors", …})` (`server.ts:2321-2336`), spec
  `server-cors` "An origin denial may be answered by prompt".

### HTTP-05 — a legacy network-only peer is untiered

- `hasNetworkPassCondition` admits `isTrustedSource(...)` last and calls
  `noteNetworkOnlyAdmission` (`auth/localhost-guard.ts:459-465`); it is the one function
  behind both the per-route `networkGuard` (`:491-508`) and the universal hook.
- The route-tier gate returns early for any non-tiered request
  (`auth/route-tier-gate.ts:71-74` `isTieredCredential`, `:117`), so no tier is checked.
  `tierRefusalFor` also exempts a trusted-source caller even when it **does** hold a tiered
  credential (`:85`).
- The hook order is host gate → CORS → mutation gate → … → tier gate (`server.ts:2647`) →
  network-guard hook (`server.ts:3702`): the tier gate runs **before** the network guard, so
  network-only classification is not available to it; the guard is where the cap belongs.
- `legacy` selection: upgrade with a non-loopback resolved entry
  (`auth/trust-mode-boot.ts:76`), operator write (`trustModeOrigin: "operator"`), unparseable
  config fallback with no origin (`trust-mode-boot.ts:64-69`). `resolveTrustMode` maps a stored
  mode without `trustModeOrigin:"upgrade"` to origin `operator` (`packages/shared/src/config.ts:189-196`).
- `admissionTrustedNetworks()` returns `[]` in `pair` (`auth/trust-mode.ts:79-82`), so `pair` is
  unaffected.
- The WS side: `authorizeWsUpgrade` ends with the same trusted-source admission
  (`auth/auth-plugin.ts:787`) and returns `{ok:true}` with no tier; the browser socket is
  tier-gated only when `socket.sessionTier` is set (`pairing/ws-tier-gate.ts:24-31`,
  stamped at `server.ts:4999` from `sessionTierOf`, `:4911`). Terminal and live upgrades check
  `roadTier` against `sessionTierOf` (`server.ts:4912-4919`).
- The 403 body for a refused network caller is deliberately identical in every trust mode
  (`localhost-guard.ts:405-415`, comment: "must not disclose the mode").
- Every refusal passes `sendNetworkDenied`, which records a block event and then raises the
  grant-prompt observer unless the caller is a proof-needing bare-loopback or a relayed
  loopback (`localhost-guard.ts:379-391`; observer at `:388`). A capped refusal is neither,
  so without an explicit suppression a listed peer's refused mutation would raise an
  operator "trust this network?" prompt for a network that is already listed.
- Per-request dedupe exists for admissions: a `networkOnlyCounted` marker on the request
  makes the per-route guard and the universal hook count once
  (`auth/network-trust-telemetry.ts:36-38,72-73`; comment `:16`).

### HTTP-04 — principals skip the tier gate

- `resolver-hook.ts` sets `authVia = "principal"` + `isAuthenticated` on a claim
  (`identity/resolver-hook.ts:113-120`); the **break-glass** local operator bearer sets the
  same `authVia` with the reserved `LOCAL_OPERATOR` principal (`:75-82`).
- `isTieredCredential` accepts only `device`/`session` (`route-tier-gate.ts:71-74`);
  `request.principalTier` is set only by bearer auth (`auth/bearer-auth.ts:143`) and the
  cookie session hook (`auth/auth-plugin.ts:510`).
- The road gate: non-session roads return when `!deps.policy.hasPolicy()`
  (`identity/identity-road-gate.ts:60`). `hasOperateAuthority` returns true for `principal`
  (`auth/operate-required.ts:55`); the vault is stricter (`vault/vault-routes.ts:126-136`).
- A WS ticket records scope, device id, principal and expiry but **no tier**
  (`TicketEntry`, `auth/ws-ticket.ts:55-82`); the upgrade stamps `socket.sessionTier` only for
  a cookie session (`server.ts:4910-4911`, `:4999`), and a socket with no `sessionTier` is not
  message-gated (`pairing/ws-tier-gate.ts:24-31`). Today the `operate` row on
  `POST /api/ws-ticket` (`shared/src/route-tiers.ts:512`) is what keeps a below-operate
  credential off an ungated `/ws`; identity-enforced `/ws`, terminal and live upgrades also
  require a principal-bearing ticket (`server.ts:4887`, `requireIdentityTicket`).
- Enforcement is decided once and frozen: `isIdentityEnforced(input)` then
  `identityRegistrations.freeze()` (`server.ts:5075-5076`), so "no host policy" is a process
  constant.
- Default `identity` block: `DEFAULT_IDENTITY` (`packages/shared/src/config.ts:1690`),
  parser `parseIdentityConfig` (`:1716`).
- The shipped host-access-policy spec says "When no `trustedPolicyPlugin` is named, non-session
  roads SHALL remain ungated" (`openspec/specs/host-access-policy/spec.md:10`).

### HTTP-03 — a control caller can delete providers

- Row `{ DELETE /api/config/auth/providers/:id, control }` (`packages/shared/src/route-tiers.ts:71`);
  `PUT /api/config` is `operate` (`route-tiers.ts:514`). The handler is guarded only by
  `networkGuard` (`routes/system-routes.ts:821-823`) and may delete the last provider with
  `?force=true` (`:827-855`). The MCP tool is generated from the row
  (`packages/mcp-server-plugin/src/server/generated/tools.ts:131`,
  `packages/shared/src/mcp/verb-tiers.generated.ts:110`).

### CRED-03 — the session JWT is not revocable

- `signToken` HS256, `expiresIn: "7d"`, no `jti`/`sid` (`auth/auth.ts:180-193`);
  `verifyToken` checks signature, algorithm pin and tier claim only (`:197-209`).
- Call sites: REST status (`auth/auth-plugin.ts:479`), the cookie hook (`:498`), the
  `validateWsUpgrade` helper (`:653`, used by tests/export only) and `authorizeWsUpgrade`
  (`:777`, the production WS path via `server.ts:4888`).
- `/auth/logout` calls `onSessionEnd` (live-preview capabilities) then `clearCookie`
  (`auth-plugin.ts:468-473`). The mutation gate already covers `POST /auth/logout`
  (`auth/mutation-origin-gate.ts:30-32`).
- Persistence primitives exist: `withLockedJsonFile` (`auth/locked-json-file.ts:154`) and
  `writeConfigFileSecure`; secrets are rotated once only (`auth/secret-rotation.ts:162,180`).
- CLI commands are a fixed word list (`cli.ts:111`).

## Goals / Non-Goals

**Goals**

- A page on a non-dashboard loopback port can neither read nor act through the dashboard API.
- A legacy network-only peer cannot mutate; operator-chosen `legacy` and `pair` are unchanged.
- Enforced identity without a host policy no longer means "every principal is operate".
- The last-provider-deletion lockout needs `operate`.
- Logout and an operator action can invalidate a stolen session JWT server-side.

**Non-Goals**

- No `Sec-Fetch-Site` layer, cookie renames or `__Host-` prefix (D1 alternatives).
- No per-principal tier from the IdP; no change to the host-policy contract.
- No change to NET-02 / `serve_mockup` binding (sibling change).
- No token-format change (`sid`), no TTL change.
- No change to `pair` mode or to the device-bearer tier model.
- No new Settings UI for revocation beyond the banner copy (API + CLI only).

## Decisions

### D1 — Loopback origins are trusted only on dashboard listener ports *(Decision D1, confirmed by operator 2026-10-26)*

`CorsOriginOptions` gains `listenerPorts?: () => { scheme: "http" | "https"; port: number }[]`, called through `safely` (like `getTunnelUrl`) over a set captured when the listeners bind (not re-read from config).
`classifyCorsOrigin` applies the rule to an origin whose host is one of the three existing
branch-3 literals (`localhost`, `127.0.0.1`, `[::1]`, `cors-origin.ts:177-179`; **no
`127.0.0.0/8` widening**) before the ladder: when its (scheme, effective port) pair (`u.port`, default
80/443 by scheme) is in `listenerPorts()` it continues (branch 3 allows it); when it is
**not**, it skips branches 3-6 and
**branch 8** (`trusted-network`, `cors-origin.ts:204-209`) and goes straight to
`cors.allowedOrigins` (branch 7), else `denied`, which `createCorsDenialObserver` already
turns into a prompt. This closes the second path (`trustedNetworks: ["127.0.0.1"]`
admitting `http://127.0.0.1:3000`) with the same predicate. Other `127.0.0.0/8` hosts
(`127.0.0.5`) are not touched: branch 3 never allowed them and an operator entry such as
`127.0.0.0/8` still admits them by branch 8 (listed as a residual in `proposal.md`). `server.ts` supplies
`[{http, config.port}, ...(TLS enabled at bind ? [{https, tls.port}] : [])]`, frozen at bind (a later config edit changes nothing until restart) — the `liveServerManager` set minus
`piPort`, with schemes. The bind family (`[::1]` owned by a same-user process while the dashboard binds IPv4-only) is an accepted residual. `piPort` is excluded because the pi gateway refuses any request carrying an
`Origin` header on TCP, before any other check (`pi/bridge-upgrade-auth.ts:124-134`,
cause `browser-origin`; spec `cross-site-request-gate`), so a browser page has no
legitimate or reachable role on that port; keeping it out of the list is conservative, not
load-bearing. Absent
`listenerPorts` ⇒ no loopback allowance (fail closed). Because CORS, `isOriginAdmitted`
(WS + mutation) and plugin WS origin admission all call `classifyCorsOrigin`, no second
list exists to drift (`cors-origin.ts` header: "can never drift").

Alternatives: A+auto-allow saved local `knownServers` (rejected: a squatter inherits trust);
`Sec-Fetch-Site` filtering (browser-only, fail-open, breaks configured sibling origins);
cookie scoping (cookies are not port-isolated). See DECISIONS-A D1.

Local-proof cookie: the hook order is host gate → CORS → mutation gate (`server.ts:2361`) → … →
tier gate/network guard, so a cross-port page's mutation or WS upgrade is refused 403 by the Origin
gate before the `pi_dash_local` cookie is evaluated. Nothing new is coded for this; the shipped
requirement "Opt-in local proof for loopback trust" (`trust-and-credential-boundaries`) is MODIFIED so
cookie admission is stated as subject to the Origin gate first, and a regression test pins it (task 1.7).

Consequence for the Access page: own-port loopback stays "structural, non-revocable"
(`server-cors` "Allowed CORS origins are reviewable and revocable"); a prompt-granted
loopback origin becomes a configured, revocable one.

### D2 — Cap network-only admission at `observe` unless the operator chose `legacy` *(Decision D2, confirmed by operator 2026-10-26)*

New helper in `auth/trust-mode.ts`: `networkOnlyTierCap(): Tier | null` =
`"observe"` when the effective mode is `legacy` and origin ≠ `"operator"` (origin `upgrade`,
`null`/fallback, or any present unrecognised value — fail closed, one warning per distinct value; an absent origin reads `operator`), else `null`. Sites:

1. `hasNetworkPassCondition` (`localhost-guard.ts:459-465`): when `cap !== null` and the
   request is not `isObserveApiRequest` and not `isModelProxyRequest`, return **false**
   (so the guard denies) and record a *capped refusal* (not an admission) in
   `network-trust-telemetry.ts`: a `refused` counter + one rate-limited `[trusted-networks]`
   line per peer per hour ("…refused: network trust alone is read-only until this device is
   paired"). The counter is deduped **once per request** with the same per-request marker
   admissions use (`networkOnlyCounted`, `network-trust-telemetry.ts:36-38,72-73`; a
   sibling `networkOnlyRefusedCounted`), because the per-route guard and the universal hook
   both evaluate `hasNetworkPassCondition` (`localhost-guard.ts:459-464`). The body stays the
   unchanged `network_not_allowed` JSON. **No network-grant prompt, block event kept:**
   `sendNetworkDenied` records a block event (`GET /api/tunnel/block-events`) and then runs
   the denial observer (`localhost-guard.ts:370-391`). The capped path keeps the record (the
   denial contract of "Network guard threaded to all protected routes") and passes a flag that
   skips only the observer — the same shape as the `proofNeeded` suppression
   (`:385-390`) — so an already-listed peer never makes the operator answer "trust this
   network?" for a network that is trusted.
2. WS: `authorizeWsUpgrade` returns `networkOnly: true` on the trusted-source branch
   (`auth/auth-plugin.ts:787`); `server.ts` then sets `sessionTierOf = () => cap` when no
   session payload or ticket tier exists, so
   `decideWsTier` drops above-observe messages (`pairing/ws-tier-gate.ts:24-31`) and the
   existing terminal/live `roadTier` check refuses terminals (operate) and live previews
   (control) (`server.ts:4912-4919`).
3. **Live-preview capability mints.** `POST /api/live-server/:id/capability` is an
   `observe` route (`shared/src/route-tiers.ts:358`), so the capped guard admits it
   (`localhost-guard.ts:482-485`), and a listed peer would reach the port-target branch. There
   `portMintRefused` (`routes/live-server-routes.ts:158-175`; call `:306`) counts
   `isTrustedSource(...)` as proof (`:172`), and only inside the `requireLocalProof` strict branch
   (`:167`); the handler stamps the caller `kind: "network"` (`:90`). That kind stays live while
   the mode is `legacy` (`server.ts:2396`), and the WS capability path is admitted before the
   network branch (`auth/auth-plugin.ts:770-774`), so the cap would otherwise be bypassed through
   a preview. Fix: while `networkOnlyTierCap() !== null` a trusted source is **not** proof in
   `portMintRefused` (a request admitted by network trust alone is refused with the `control`
   tier refusal, independent of `requireLocalProof`), and `isPrincipalLive` for `kind: "network"`
   is `effectiveTrustMode().mode === "legacy" && networkOnlyTierCap() === null`, so capabilities
   minted for a network-only principal die under the cap (HTTP and WS). Operator-origin `legacy`
   is unchanged.

Not changed (residual): `tierRefusalFor` exempts a caller from its tier when it is locally trusted (`route-tier-gate.ts:84`) or on a listed network in `legacy` (`:85`), **including a caller that holds a device/session credential or an identity principal**. So a credentialed principal on a listed network in `legacy`, and a locally trusted principal, are not tier-capped by D3 and are not narrowed by this cap. The exemption is spelled out in `bearer-device-auth` (stacked by `device-key-mutual-check` and `add-plugin-isolation-and-public-routes`) and needs a credential; `pair` is the fix.

Not capped: genuine-local (loopback + proof), local-IPC token, any signed-in session,
device bearer/cookie, valid ticket, model-proxy key. In `pair` the list is `[]` so none of
this runs.

Spec narrowing: the cap is specified as ADDED requirements that narrow condition (d) of "Network guard factory" (MODIFIED) and the WS/bypassHosts requirements, the same technique `trust-and-credential-boundaries` uses for local proof. Shipped scenarios that assert network-only admission are MODIFIED to read-only wording: "Network guard threaded to all protected routes" ("Session route uses network guard", "runtime-added trusted CIDR admits without restart"), "Relayed loopback requests are never trusted by network entry" ("LAN trusted CIDR unaffected"), "auth.bypassHosts honored without OAuth providers" ("Auth plugin stays inactive with bypassHosts-only config"), and "Loopback trusted entries are reported as inert" (`networkOnly` gains `refused`).

Alternatives: uniform cap (rejected: overrides an informed operator choice); retire
`legacy` (largest break); keep + warn. See DECISIONS-A D2.

Observability: `trustPosture.networkOnly` gains additive `refused`; Settings ▸ Access
banner (upgrade origin) states "read-only until paired".

### D3 — Principals are tier-capped while no host policy is registered *(Decision D3, confirmed by operator 2026-10-26)*

- `IdentityConfig.defaultPrincipalTier: Tier` (default `"control"`; `parseIdentityConfig`
  falls back to `control` for a missing/unknown value; documented next to
  `trustedPolicyPlugin`).
- `ResolverHookDeps` gains `principalTierCap: () => Tier | null`
  (`= () => policyRegistry.hasPolicy() ? null : bootCap`; the cap is frozen at boot like the policy, so a runtime edit applies after restart and issued tickets keep their recorded tier). On the
  **claim** path only (`resolver-hook.ts:113-120`) the hook also sets
  `request.principalTier = cap` when non-null. The break-glass path (`:75-82`) is left
  untouched, so the local operator is never capped.
- `isTieredCredential` accepts `authVia === "principal"` **iff** `request.principalTier` is
  set. With a policy present `principalTier` stays unset and behaviour is unchanged
  (policy authoritative, identity road gate decides).
- `hasOperateAuthority`: `principal` → `principalTier === undefined || principalTier === "operate"`
  (`operate-required.ts:55`); `canOperate`/`tierRefusalFor` then agree. The refusal body follows:
  `describeOperateRefusal` counts a principal with `principalTier` set as a tiered credential
  (`operate-required.ts:97-98`), but the route-tier gate refuses a capped principal first (403 `insufficient_scope`, `scope="operate"`) on `/api/vault*` and `/api/services*`; `operate_required` + `tier-too-low` stay for gate-exempt callers (the off-network low-tier device precedent).
- WS: the upgrade stamps `sessionTier = () => cap` for a ticket principal while no policy
  (reuses the `sessionTierOf` seam at `server.ts:4911`), which also applies the terminal
  (operate) and live-preview (control) road gates.
- **Ticket minting (confirmed D3 cap vs `POST /api/ws-ticket`).** The row is `operate`
  (`route-tiers.ts:512`) and an identity-enforced `/ws` needs a principal ticket
  (`server.ts:4887`), so a `control`-capped principal could not open `/ws` at all. Fix: lower
  the row to `control` and enforce a **per-scope minimum inside the mint handler**
  (`server.ts:3515-3568`) for every tiered caller (device, session, principal) with the
  existing `tierRefusalFor` (precedent: `routes/live-server-routes.ts:160-162`, which also
  keeps its local / listed-network exemptions): `browser` `control`, `live` `control`
  (`LIVE_PREVIEW_TIER`), `terminal` `operate` (`TERMINAL_TIER`), `bridge` `operate`
  (unchanged, plus `decideBridgeTicketMint`). A new `WS_TICKET_MIN_TIER` map next to
  `TERMINAL_TIER` (`shared/src/ws-message-tiers.ts:129-131`) holds it. The refusal is
  `sendTierRefusal(reply, minTier)`.
  **Correction found at verification:** per-message `ws-message-tiers` do **not** gate a
  ticket-admitted socket today — tickets carry no tier (`ws-ticket.ts:55-82`) and only a
  cookie session sets `sessionTier` (`server.ts:4911`). Lowering the row alone would hand a
  `control` device or session an **ungated** `/ws` (operate-tier messages included).
  So the ticket also records the minter's tier (`TicketEntry.tier`, set when the caller is
  not exempt) and, for a session-cookie mint, the token digest and `iat`
  (`TicketEntry.sessionRef`); `consumeDetailed` returns them and the upgrade builds
  `sessionTierOf` from the ticket (tier, `null` once its `sessionRef` is revoked) when no
  cookie payload exists. Compatibility: control-tier paired devices and control sessions can
  now open a `/ws` that was previously unreachable to them; it is message-gated at their
  tier. `POST /api/ws-ticket` stays on the MCP denylist (`tools.denylist.ts:90`), so no MCP
  artifact changes. An `observe` cap/credential still cannot mint, hence no socket.
  `add-android-server-host` probes this route and treats a `control` device's 403 as
  "needs full access" (its spec line 38); with this change that probe passes at `control`
  — it must re-decide (listed `related`).
- Boot log: `[identity] no host policy: principals are capped at '<tier>' (identity.defaultPrincipalTier)`,
  emitted next to the arming block (`server.ts:5075-5084`).

Alternatives: default `observe`; refuse to arm; `Principal.tier` from the resolver. See
DECISIONS-A D3.

### D4 — Session revocation by token digest + `notBefore` *(Decision D4, confirmed by operator 2026-10-26)*

New `auth/session-revocations.ts`:

```ts
interface RevocationFile { notBefore: number /*unix s*/; revoked: { d: string /*base64url sha256(token)*/; exp: number }[] }
class SessionRevocations {
  isRevoked(token: string, payload: { iat?: number; exp?: number }): boolean;
  revoke(token: string, exp: number): void;     // logout
  revokeAll(nowSec: number): void;              // notBefore = now; clear list
}
```

- Stored at `~/.pi/dashboard/session-revocations.json` via `withLockedJsonFile`, `0600`;
  in-memory copy loaded at boot, written through on change. The path is under the dashboard
  state directory, so the existing always-refused guard already covers it
  (`trust-and-credential-boundaries` "Dashboard state is never served…").
- Bounds: entries drop at their own `exp` (a token is dead by then); cap 5 000 live entries;
  on overflow set `notBefore = now` and clear (fails closed: revokes more, never less).
  `notBefore` is monotonic (`max(previous, now)`). A file that is unreadable, zero bytes or does
  not validate as `{notBefore: number >= 0, revoked: {d: string, exp: number}[]}` is corrupt
  (mass logout). Write failure never drops an in-memory revocation: logout/revoke-all answer 500
  `revocation_not_persisted` (logout still clears the cookie); boot continues with the
  in-memory `notBefore`; a throwing sweep is logged, the response stays 200 and the lazy 4401
  gate closes the rest.
- `verifyToken(token, secret, revocations?)` returns `null` for a revoked token. All four call
  sites pass the store (REST status, cookie hook, WS helper, `authorizeWsUpgrade` via a new
  `isTokenRevoked` option), and a unit test asserts no call site omits it. An absent store means
  "no revocation" and exists only for tests.
- `authorizeWsUpgrade` returns the verified token's digest (and `iat`) in `WsUpgradeAuthResult`
  next to `session` (`auth/auth-plugin.ts:777-778`; result type `:665`; call site
  `server.ts:4910-4911`). The `sessionTierOf` closure becomes
  `() => store.isRevoked(digest, payload) ? null : effectiveSessionTier(payload, passkeyService)`, so
  a revoked token's socket reads as `null` tier — the value the sweep and the lazy 4401 gate
  already treat as revoked (`ws-tier-gate.ts:24-31`, `:33`). Tickets minted from a session
  carry the same `{digest, iat}` (D3 "Ticket minting"), so ticket-admitted sockets are swept too.
- `/auth/logout` (`auth-plugin.ts:468`): digest the presented cookie, `revoke(token, exp)`,
  then the existing `onSessionEnd` + `clearCookie`; always 302 `/auth/login` + cleared cookie,
  but revoke, audit and `onSessionEnd` only when the token verified (an absent, garbage,
  foreign-signed, expired or already-revoked token stores nothing). A ticket whose `sessionRef`
  is revoked is refused at upgrade (`HTTP/1.1 401`, ticket consumed). Writes an audit line
  `auditLine("oauth","session_revoked",{reason:"logout"})` via `auth/audit-log.ts` (no token,
  no identity beyond what existing lines carry).
- Revoke all: `POST /api/auth/revoke-sessions` (`networkGuard`, tier `operate`, new
  `ROUTE_TIERS` row) sets `notBefore = now`, audits `{reason:"revoke_all"}`, and invokes the
  socket sweep. **Sweep helper (restated, not assumed):** `close-security-map-high-findings`
  task 3.4 adds an `onAuthReloaded` callback to `registerAuthPlugin` whose `server.ts`
  closure "sweeps `browserGateway.wss.clients` (`pairing/browser-gateway.ts:2633`) and
  `terminalGateway.wss.clients` (`terminal/terminal-gateway.ts:14,40`) and closes each socket
  whose `sessionTier?.()` is `null` with `WS_CLOSE_SESSION_REVOKED` (4401,
  `pairing/ws-tier-gate.ts:33`)", synchronously, wrapped so a throw is logged and logs one
  aggregate line when N>0. This change factors that closure's body into one function,
  `sweepRevokedSockets()`, and calls it from revoke-all **and** logout; until that change
  lands the function is added here and its terminal `sessionTier` stamp
  (`TerminalGateway.handleUpgrade`, task 3.4 there) is a prerequisite (`blocked_by`). CLI: `pi-dashboard revoke-sessions` (exit 0 success, printing the `notBefore` time and sockets closed; 1 server down / no local token / HTTP error; 2 usage, as `cmdLogin`)
  (word added to `COMMAND_WORDS`, `cli.ts:111`; authenticates with the local token like
  `login --local`). The route is not an agent capability: MCP manifest completeness requires
  a denylist entry ("session revocation stays an operator action").
- Open-socket behaviour on **single** logout: **swept, not lazy.** Logout revokes the digest,
  then calls the same `sweepRevokedSockets()`; the closure above reads `null` for exactly the
  sockets that token admitted (directly or by ticket), so they close with 4401 before the logout
  response completes and other sessions' sockets stay open. The lazy next-frame check remains
  as the backstop.
- **Live-preview capabilities.** `isPrincipalLive` for a `session` principal
  (`server.ts:2393-2399`) also consults the store — `notBefore` via the principal's
  `session.iat` (a capability carries the verified payload, not the token; logout already
  revokes its capabilities through `onSessionEnd` → `revokeBySessionKey`, `server.ts:2550`,
  `live-server/live-capability.ts:55-58`). Revoke-all therefore ends session-minted previews
  on their next request (liveness is re-checked at every use). Device/network/local
  principals are untouched.
- Not changed: token format, TTL (7 d), cookie flags, passkey liveness re-check.

Alternatives: `sid` claim + session table; 12 h sliding TTL; rotate-only. See DECISIONS-A D4.

### D5 — Provider deletion is `operate` *(Decision D5, confirmed by operator 2026-10-26)*

Change the row (`route-tiers.ts:71`) to `operate`; regenerate
`mcp/verb-tiers.generated.ts`, `generated/tools.ts` and the README tool table with
`pnpm --filter @blackbelt-technology/pi-dashboard-mcp-server-plugin codegen`
(`packages/mcp-server-plugin/package.json:62`); the chat gateway never exposes this verb: it is held out by the allowlist, not by tier
(`packages/chat-gateway/src/server/team/tier.ts:19-37`), so chat is unaffected. No handler
change. Alternative B (split last/force) rejected as extra branching for a rare action.

### Why these are one change

All five alter *who may exercise operator authority over HTTP*, share the tier model
(`ROUTE_TIERS`, `tierRefusalFor`, `sessionTierOf`) and the same specs; shipping them
separately would touch `route-tier-gate.ts`, `server.ts` WS upgrade and `trusted-networks`
three times.

## Risks / Trade-offs

- **Existing tests assume network-only operate.** With no stored mode the effective mode is
  `legacy` with origin `null` (`trust-mode.ts` `trustModeOf` fallback), so unit tests that
  use a trusted network and POST will hit the cap. Mitigation: task 2.7 enumerates them and
  sets `trustModeOrigin:"operator"` (or pair + credential) explicitly; no production default
  changes for those tests.
- **Cross-port dev tooling breaks (D1).** Documented as BREAKING with the two escapes; the
  denial prompt makes it self-serve.
- **WS stamp for network-only sockets** is a new tier source; a reconnecting LAN browser
  gets read-only UI. Banner copy and docs explain; operator-origin `legacy` unaffected.
- **Cap value `control` (D3)** still lets a realm user drive sessions they own and spawn;
  that is the multi-user intent. Terminals and config remain operate. Event fan-out and
  non-session bootstrap disclosure remain unfiltered without a policy (residual, read-level).
- **Revocation file growth / corruption.** Bounded (cap + expiry); a corrupt file is
  quarantined by `withLockedJsonFile` and treated as empty with an error log — **that reopens
  revoked tokens**; to stay fail-closed, a corrupt/unreadable file at boot sets
  `notBefore = now`, persists it (so the next boot does not repeat it) and logs one error: a
  **mass logout of every session after a corruption event**, listed as BREAKING item 5 in
  `proposal.md`. An absent file is an empty store (first boot after upgrade logs nobody out).
- **`iat` granularity** is seconds: a token minted in the same second as `revokeAll` is also
  revoked (`iat <= notBefore`); intended.
- **Telemetry bound (D2).** Admitted and refused peers share the `MAX_PEERS` (256) map, so a
  flood of refused peers saturates `distinctPeers` at 256 and may displace admission-only peers.
- **No absolute performance budgets.** Revocation lookup, socket sweep and the cap check are held
  to a relative budget: <= 5 % regression versus the pre-change baseline of `auth.test.ts` and
  `browser-gateway-load.test.ts`; the size bounds (5 000 entries, 256 peers) are the only absolutes.
- **MCP tier change (D5)** may surprise an automation using a `control` token to prune
  providers; it gets the standard scope challenge.
- **Docker E2E harness (D2).** `docker/test-entrypoint.sh:221` seeds
  `trustedNetworks: ["0.0.0.0/0"]` with **no** `network.trustMode`, so the boot decision persists
  `legacy` with origin `upgrade` and the cap would make every browser mutation from the
  Playwright host (a non-loopback peer, Docker NAT) 403. The seed must instead write
  `network: { trustMode: "legacy" }`, which reads as origin `operator`
  (`shared/src/config.ts:193`: a stored mode without `trustModeOrigin: "upgrade"`), keeping the
  disposable harness's trust-any-peer posture. The seed program is covered by
  `scripts/__tests__/e2e-trust-seed.test.mjs` (task 2.8). Real Docker users who listed the
  Docker gateway/bridge range in `trustedNetworks` and relied on it for a host browser are
  upgrade-decided `legacy` and become read-only until paired (BREAKING item 2).
- **Spec stacking.** Whichever archives second must re-copy these blocks:
  `server-cors` "CORS enabled on dashboard server" (also MODIFIED by
  `add-plugin-isolation-and-public-routes`, text copied from its delta);
  `trusted-networks` "Network guard factory" and `oauth-authentication` "Localhost and trusted
  host bypass" (also MODIFIED by `add-plugin-capability-routes`; condition (e), its scenarios
  and the capability sentence are copied here, on the shipped `legacy`-aware text);
  `bearer-device-auth` "A device bearer's tier gates REST routes and WS-ticket minting" (also
  MODIFIED by `device-key-mutual-check` and `add-plugin-isolation-and-public-routes`; the block
  here is the union of both deltas plus the per-scope mint minimum).
  `trust-and-credential-boundaries` "Opt-in local proof for loopback trust" (also MODIFIED by
  `close-loopback-legacy-window`, whose delta sits on pre-`close-container-loopback-impersonation`
  text; the block here is copied from the SHIPPED text so archiving cannot revert the default-true).
  `close-security-map-high-findings` adds the session-validation and socket-sweep code the
  revoke path reuses.

- **Collateral scan** (`spec-collateral`, advisory) flagged shipped requirements whose text the caps contradict. All are now MODIFIED here: `auth-bypass-url-list` "Configurable trusted hosts (auth bypass by source IP)", `oauth-authentication` "Localhost and trusted host bypass", `trusted-networks` "WebSocket upgrade respects trusted networks" and "WebSocket upgrade admits bypassHosts trust without OAuth" (IP match alone no longer suffices in upgrade-decided `legacy`), `settings-panel` "Trusted Networks section on Security tab" (heading, wide-range and warning copy for upgrade-decided `legacy`), `operate-required-remedy` "Operate refusals carry a reason and remedies" (a capped principal is refused by the tier gate with `insufficient_scope`, not `operate_required`; "Admission unchanged" scenario narrowed: a principal is admitted only with a host policy or an `operate` cap), and `bearer-device-auth` (ws-ticket tier). `trusted-networks` "Network guard threaded to all protected routes", "Relayed loopback requests are never trusted by network entry", "auth.bypassHosts honored without OAuth providers" and "Loopback trusted entries are reported as inert" are MODIFIED for the cap (read-only wording, `refused`), and `trust-and-credential-boundaries` "Opt-in local proof for loopback trust" is MODIFIED so the local-proof cookie is subject to the Origin gate first (D1).

## Migration / Rollback / Compatibility

- **Data:** one new file `session-revocations.json` (created lazily, `0600`); no migration of
  existing files. Config: optional `identity.defaultPrincipalTier`; absent ⇒ `control`.
- **Compatibility:** existing JWTs keep verifying unless revoked; `pair`, device bearers,
  genuine-local, tunnels, the neutral shell and configured CORS origins behave as before.
  Behaviour changes are the four BREAKING items in `proposal.md`, each with an escape.
- **Rollback:** revert the commit(s). The revocation file is ignored by older code (a logged-out
  token becomes valid again until expiry — same as today). `defaultPrincipalTier` is ignored by
  older parsers. No schema versioning needed.
- **Staging:** land D5 (tier row + regen) and D1 first (independent, small); D2/D3 touch the WS
  upgrade stamp and the ticket tier together; D4 last (depends on `close-security-map-high-findings` code).
- **Ordering vs other changes:** blocked by `close-security-map-high-findings` (shared
  `auth.ts`/`auth-plugin.ts`/`oauth-authentication`, and the socket-sweep closure),
  `add-plugin-isolation-and-public-routes` (stacked `server-cors` and `bearer-device-auth`),
  `device-key-mutual-check` (stacked `bearer-device-auth` ws-ticket requirement),
  `add-plugin-capability-routes` (stacked `trusted-networks` "Network guard factory" and
  `oauth-authentication` "Localhost and trusted host bypass") and `close-loopback-legacy-window`
  (stacked `trust-and-credential-boundaries` "Opt-in local proof for loopback trust"); `related`:
  `enforce-strict-csp-default`, `add-android-server-host`.

## Open Questions

None. D1–D5 are confirmed (operator, 2026-10-26; `/tmp/secmap/batch2/DECISIONS-A.md`). The
corrupt-revocation-file policy is fail closed (mass logout), recorded as BREAKING item 5.
