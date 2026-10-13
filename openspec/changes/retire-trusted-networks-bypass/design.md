## Context

See proposal.md (Why). Current state, from source:

- `isTrustedSource(ip, headers, trusted, localTrust)` (`packages/server/src/auth/localhost-guard.ts:198`) is the single peer-IP trust predicate (enforced by `trusted-source-single-predicate.test.ts`). Five admission sites call it:
  1. `hasNetworkPassCondition` (`localhost-guard.ts:388`), shared by the per-route `createNetworkGuard` (`:438`, call at `:453`) and the universal `createNetworkGuardHook` (`:704`, call at `:768`). It checks trusted **before** `request.isAuthenticated` (`:411-412`). About 160 routes also carry `preHandler: networkGuard`, so one request runs it twice.
  2. `auth-plugin.ts:463` OAuth `onRequest` `bypassHosts` skip — runs **before** the JWT cookie check (`:466`), against `authState.bypassHosts`, a copy taken at registration (`:200`) and refreshed only by `_reloadAuth` (`:225`) on an `auth`-carrying config write.
  3. `auth-plugin.ts:534` `validateWsUpgrade` and `:632` `authorizeWsUpgrade` — trusted branch **before** ticket and cookie.
  4. `server.ts:3869` WS upgrade handler: `const trusted = config.resolvedTrustedNetworks ?? []` — the **boot** value, passed to `authorizeWsUpgrade` (`:3978`). Not live.
  5. `route-tier-gate.ts:85` `tierRefusalFor` — trusted-network tier exemption (reads a live thunk).
- `server.ts:3977` `requireIdentityTicket`: with the identity floor enforced, `browser`/`terminal`/`live` upgrades accept only a principal-bearing ticket — ahead of every other allowance (`auth-plugin.ts:613-620`).
- `sendNetworkDenied` (`localhost-guard.ts:329`) notifies `networkDenialObserver`; `server.ts:1880` wires it to `grantCoordinator.onDenial({ plane: "network" })`. `createNetworkPlane` (`server.ts:1840`) reads/writes top-level `trustedNetworks` only (pre-existing deviation from the canonical `auth.bypassHosts` write path; left as is, now `legacy`-only).
- `bearer-auth.ts:56-69`: `pi_dash_device` cookie value **is** the durable bearer; `Path=/api/` (`:103`), accepted only for `/api/` pathnames (unchanged by this change).
- The live preview iframe is sandboxed without `allow-same-origin` (`LiveServerViewer.tsx:146`), i.e. an opaque origin.
- `/live/*`: `live-server-proxy.ts` forwards HTTP via `@fastify/reply-from` (copies all request headers incl. `cookie`) and WS via `handleLiveServerUpgrade` (`:109-112`, forwards every header except `host`/`origin`). The OAuth cookie (`Path=/`) already leaks upstream today.
- `/editor/*`: in guard jurisdiction (`localhost-guard.ts:464`) but **not served** — the editor proxy was removed (`live-server-proxy.ts:24-28`).
- `/v1/*`: `model-proxy/auth-gate.ts:45-62` requires a `pi-proxy-*` key on every request; network trust never admitted keyless `/v1` traffic.
- `/api/health` `trustPosture: { trustedHasLoopback } | null` behind `canDiscloseAccessPosture` (`localhost-guard.ts:106`: authenticated or genuine-local).
- `cors-origin.ts:166` and the WS origin gate (`server.ts:1808`, `:3937`) also match the list (origin allowlists, not authentication).

Prerequisites: `add-lan-knock-pairing` (knock route, private-range gate, `pairing.acceptLanRequests` default **off**, Request access landing) and `add-electron-server-windows`. Neither is archived yet; task 0.1 gates implementation.

## Goals / Non-Goals

**Goals:**
- One switch (`network.trustMode`) that removes network-match authentication at all five sites at once, live, with `legacy` as the rollback.
- The mode can never widen because the list changed.
- Truthful, once-per-request telemetry of who still depends on network trust.
- A paired browser keeps what network trust granted (within its tier), including remote live previews with HMR.

**Non-Goals:**
- Flipping upgrade-origin `legacy` installs to `pair` — follow-up change one minor release later, gated on the audit.
- CORS origin allowlist and WS origin gate keep matching the list (no credential follows from either).
- Any `/editor/*` behaviour — guarded but nothing is served there.
- Changing the device cookie's scope (stays `Path=/api/`).
- Persisting telemetry across restarts.
- Fixing `createNetworkPlane`'s top-level `trustedNetworks` write (pre-existing; legacy-only after this change).

## Decisions

### D1 — One live, mode-dependent admission list
Add `admissionTrustedNetworks(): string[]` in `localhost-guard.ts` = `effectiveTrustMode() === "pair" ? [] : liveTrustedList()`, read per request. All five sites take their list from it:
- site 1 and 5: replace their thunks;
- site 2: stop using `authState.bypassHosts` for the skip; call the thunk per request;
- site 3/4: replace `server.ts:3869`'s boot value with the thunk per upgrade.

`isTrustedSource` is unchanged (`isTrustedSource([])` is already `false`). Extend the static scan test so admission sites may obtain their list only from `admissionTrustedNetworks`; `cors-origin.ts` and the WS origin gate stay exempt (non-goal).
- *Alternatives:* a `mode` argument on `isTrustedSource` (five places to get right); deleting the call sites (loses rollback).

### D2 — Decide the mode once at first boot, persist it
At boot, when `network.trustMode` is absent, write `{ network: { trustMode, trustModeOrigin: "upgrade" } }` through `writeConfigPartial`: `pair` iff every entry is loopback-only — reuse and extend the existing `isLoopbackOnlyEntry` (`packages/shared/src/bind-reachability.ts:143`, IPv4-only today, used by `gateway-config-ops.ts:108`) with `::1` / `::ffff:127.x`; hostnames (incl. `localhost`) and match-all entries stay NOT loopback-only (unlike `loopbackCoveringEntries`, which tests coverage) — else `legacy`. Undecidable ⇒ `legacy`, never a lockout. The decision runs before the server listens, so no operator write can race it. Never re-derive. UI writes set `trustModeOrigin: "operator"`. Unknown stored value → effective `pair` (fail closed), warning once per process per value, no rewrite; the Security page shows it with a warning. Write failure → a process-level fallback read by `effectiveTrustMode()` only while the snapshot holds no recognised `trustMode` (a stored value always wins, so rollback stays live) + one error; decided again next boot. A present-but-unparseable `config.json` is never decided or written (`writeConfigPartial` would otherwise rewrite it from `{}` and drop secrets — `config-api.ts:210-222`, `:363`); the process runs `legacy`. `writeConfigPartial` enforces origin: any change to a stored `trustMode` stamps `operator` (UI, REST, CLI alike); a stored mode without origin reads `operator`. `writeConfigPartial` gains a field-level `network` merge (like `auth`). `resolveTrustMode(config)` in `packages/shared/src/config.ts` returns `{ mode, origin }`.
- *Why:* deriving on every load lets one added range (including the new "allow requests" action) silently switch a `pair` install to whole-range admission. A persisted decision closes that, keeps every upgrading LAN user working, and gives the banner a truthful origin.
- *Alternatives (rejected by the user):* derive per load and write the effective mode on each Security Save (hand edits can still flip it); unset ⇒ `pair` (locks out upgrading LAN users).

### D3 — Credentials before network match; count once
Reorder `hasNetworkPassCondition` (`isAuthenticated` first), the OAuth hook (validate a presented session cookie before the bypass skip, so a signed-in LAN browser is tagged `authVia = "session"`). An OAuth bypass-host skip leaves the request unauthenticated, so it is counted once at the guard (site 1), not at site 2, and both WS authorizers (ticket/cookie before trusted). Admission outcomes are unchanged. Side effects kept to today's: on a bypass-host request an invalid session cookie is NOT cleared. Accepted difference: a ticket presented with a listed address is now consumed (the client mints one per connect). A WS upgrade has a single attribution point, so no per-request marker is needed there.

### D4 — In-memory network-only telemetry
New `packages/server/src/auth/network-trust-telemetry.ts`: `noteNetworkOnlyAdmission(request | upgrade, now)`, `snapshot(now)`. A per-request marker (`request.networkOnlyCounted`) makes the per-route guard and universal hook count once. `Map<ip, lastSeen>` with delete-then-set refresh (recency order), cap 256 (least recently seen evicted), window `min(7 days, uptime)`, per-peer log throttle 1 h. Counted only where the network match itself admitted (sites 1, 3, 4).

### D5 — Per-preview capability path for `/live/`; strip dashboard credentials
Spike (real browser, sandboxed `allow-scripts` iframe): a `SameSite=Strict` cookie at `Path=/live/` rode only the frame navigation; the preview's `<img>`, `fetch` and WebSocket carried **no** cookie. So no cookie scheme can authenticate a remote preview; only network trust does today.

Mechanism: `POST /api/live-server/:id/capability` (tier `control`) returns `/live/<id>/~c/<token>/`. `LiveCapabilityStore` (in memory, hash-only) binds token → target id + minting principal (+ tier, + identity principal if any); idle 30 min, absolute 12 h; invalidated on target removal, device revocation, session end, restart. An `onRequest` hook before the universal guard validates the capability prefix and sets `isAuthenticated` / `authVia = "live-capability"` / principal tier — for that prefix only. The WS upgrade path reads the token from the same path segment (never query/subprotocol) inside `authorizeWsUpgrade` for `live` scope, including in the identity-ticket-only branch, where only identity-minted capabilities pass. Matching is segment-exact on the raw pathname; dot-segments and percent-encoded `/`, `~`, `.` are refused. Invalidation hooks: target removal (`liveServerManager.remove`), device revocation (paired-devices registry delete), session end (logout / passkey user revoke) each call `LiveCapabilityStore.revokeBy*`. The proxy's `resolve()` strips `/~c/<token>`, `rewriteHeaders` keeps redirects inside the capability prefix, adds `Referrer-Policy: no-referrer` when absent, strips the capability segment from a forwarded `Referer`, drops upstream `Set-Cookie` for `pi_dash_*` names; server logs redact the token. The viewer always frames a capability path (uniform for local and remote).

Credential stripping (both `forward` and `handleLiveServerUpgrade`): remove `pi_dash_device` and `pi_dash_token` (`auth.ts:163`) from `Cookie`, drop `Authorization` only when it verifies as a dashboard device bearer; keep everything else so the app's own session survives.
- *Why:* the only same-origin credential an opaque-origin document can carry is one in its own URL. Scope is one preview, short idle life, revocable, never valid for `/api`.
- *Trade-offs:* the token is visible to the previewed app (it already controls that preview) and to anyone the user shares the URL with (expires idle). Apps that emit absolute-root URLs (`/assets/…`) already break under `/live/<id>/`; unchanged.
- *Alternatives:* `/live/` cookie (spike: does not work); `allow-same-origin` (breaks the isolation spec); a separate port/host (breaks the single-port tunnel, forbidden by `live-server-preview`).

### D6 — Network plane goes quiet in `pair`
`sendNetworkDenied` still records the block event; the observer in `server.ts` returns early in `pair`. `createNetworkPlane`, the pending-request accept action and the accept endpoint `POST /api/tunnel/block-events` (`routes/system-routes.ts:481`) are gated the same way (403 under `pair`, nothing written). The ring-buffer requirement "the denial is the access request" is narrowed (MODIFIED delta here) to the denial ledger, so the knock route — which creates a pending *device*, never a ledger entry — does not contradict it.

### D6b — UX
Mockups: `mockups/network-trust.html`, plan `mockups/ui-plan.md`. The mode radio sits on Security ▸ Network access (draft + panel Save, saved value shown, inline consequence instead of a modal). Switching to `pair` with `pairing.acceptLanRequests` off shows that dependency and a pre-checked "also accept access requests" checkbox in the same Save, so the flip cannot strand LAN devices without a self-service path. The Access page keeps its revoke-only contract and gets a banner linking to Security. The denied device's bar gets one primary Request access action, keeps Settings → Servers as secondary (prerequisite's requirement), and moves from Tailwind amber classes to `--severity-*` tokens. `trustPosture` stays behind `canDiscloseAccessPosture` (a credential-less, network-admitted caller learns nothing); the banner reaches local and signed-in/paired operators. Contrast probe: 0 failures over 118 text nodes in base dark, base light, nord dark.
- *Alternative:* mode toggle on Access — rejected (Access is revoke-only by spec; a toggle implies immediate effect).

### D7 — Knock eligibility = private ranges ∪ raw list
The knock address gate (owned by `add-lan-knock-pairing`) gains a list branch: no proxy-forwarding header at all (as strict as its private-range branch, `add-lan-knock-pairing/design.md`) and a match against the raw list minus match-all entries (`0.0.0.0/0`, `::/0`, `*.*.*.*`). The Security "allow requests" action adds the exact address, never a range.

### D8 — Consumer audit gates the follow-up flip
`audit.md` (task 1.1) records each consumer; expected outcome:

| Consumer | Today on a LAN | Under `pair` | Expected status |
|---|---|---|---|
| Remote bridge `/ws/bridge` | ticket (`bridge` scope); verify no network-only path | ticket | ok (verify) |
| MCP clients `/mcp` | in-handler device token | unchanged | ok |
| CLI | local token on the host | unchanged on host; remote → `token create` | ok |
| Model proxy `/v1/*` | `pi-proxy-*` key always required | unchanged | ok |
| Browser in-page server switch | cross-origin bearer + network trust for `<img>`, iframes, downloads | no equivalent; prerequisite keeps the in-page switch for browsers | **blocker for the N+1 flip**; an operator who opts into `pair` accepts it (stated in the consequence callout) |
| Electron server windows | prerequisite opens remotes on their own origin | device cookie | ok |

## Risks / Trade-offs

- [LAN users locked out after an operator sets `pair`] → consequence callout with device count and the knock dependency; `legacy` is one Save away and applies live.
- [`pair` before `add-lan-knock-pairing` ships] → task 0.1 blocks implementation.
- [Boot config write on a read-only config] → in-memory decision + error log; decided again next boot.
- [Telemetry undercounts after restart] → advisory; copy says "in the last 7 days or since the last restart".
- [Capability token in a URL] → one preview, 30 min idle, revocable, no referrer, redacted logs (D5).
- [Identity floor enforced] → only identity-minted capabilities satisfy it (stated in the spec).
- [`observe`/`control` paired browsers cannot open the live UI socket — `/api/ws-ticket` requires `operate` (`route-tiers.ts:410`); network trust used to bypass tiers] → by design; pairing defaults to `operate`; the consequence callout says so.
- [`observe`-tier paired browsers cannot mint preview capabilities] → by design (`LIVE_PREVIEW_TIER = "control"`, `ws-message-tiers.ts:122`); network trust used to exempt tiers.
- [Ticket consumed by reordered WS checks] → harmless; one ticket per connect.
- [CORS / WS origin gate still widened by the list] → no credential granted; non-goal.
- [`server-bind-host` text "both feed the runtime guard" (`shared/src/bind-reachability.ts:209`) is stale in `pair`] → code comment fix in task 9.3; no behaviour change.

## Migration Plan

1. **This change (release N):** `network.trustMode` + boot decision; admission list; telemetry + `/api/health` + banners; live capability path; credential stripping; knock eligibility from the list; mode-specific UI. CHANGELOG **BREAKING** entry scoped to installs that choose `pair` with a non-empty list (fresh installs see no behaviour change).
2. **Follow-up (release N+1):** move `trustModeOrigin: "upgrade"` + `legacy` installs to `pair` once `audit.md` has no blockers (the in-page switch row must be resolved first). Operator-origin `legacy` stays.
3. **Rollback:** Save "Trust whole networks" (or write `network.trustMode: "legacy"`); applies live. Reverting code is not required; the persisted `network` block and `/live/` cookies are ignored by older builds.
