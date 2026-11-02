# Design — surface-network-denial-on-health

## Context

- Two network-admission predicates exist today:
  - REST: `hasNetworkPassCondition` (`packages/server/src/auth/localhost-guard.ts:432-464`), shared by the per-route guard `createNetworkGuard` (`:491`) and the universal hook `createNetworkGuardHook` (`:757`). Order: locally trusted (+proof under strict) → strict bare-local observe / model-proxy exception (`:442-449`) → local token (`:452`) → `isAuthenticated` (`:456`) → trusted source with `noteTrustedList` + `noteNetworkOnlyAdmission` telemetry (`:457-463`).
  - WebSocket: `authorizeWsUpgrade` (`packages/server/src/auth/auth-plugin.ts:697-790`) — locally trusted, local token, ticket/capability, session cookie, trusted source. No `bypassUrls` handling.
- `/api/health` is in `PUBLIC_IN_NAMESPACE_PATHS` (`localhost-guard.ts:529-532`); the universal hook returns before any pass check, so the predicate never runs for it today.
- `isAuthenticated` on `/api/health`: `bearer-auth.ts:111-123` verifies device bearer / device cookie for every request; `auth-plugin.ts:553-556` tags a session cookie when `request.url === "/api/health"` (exact match; a `?query` misses it). With OAuth off, only the bearer hook runs.
- Health already emits `localProof: "required"` via `needsLocalProof` (`system-routes.ts:1241`), typed in `packages/shared/src/local-proof-signal.ts`.
- `/api/health` is observe-tier (`packages/shared/src/route-tiers.ts:152`), so `hasNetworkPassCondition` called on the health request passes a strict bare-local caller through the observe exception.
- `admissionTrustedNetworks` (`packages/server/src/auth/trust-mode.ts:79-83`) reads `getConfigSnapshot()`, whose `stamp()` does one `fs.statSync` per call (`packages/server/src/config-snapshot.ts:39-45`). Re-parse only on mtime/size change.
- Client: `useNetworkDenied` probes only in `offline` / `auth_required` (`packages/client/src/hooks/useNetworkDenied.ts:70-73`). With OAuth configured, `auth_required` drives the login redirect (`App.tsx:852`), so the sign-in gate is what such a user sees.

## Decisions

### D1 — Field on health, not a guarded probe target
Health reports the caller's own verdict. Rejected alternative: the client probes a guarded route for the real 403. Every probe (10 s cadence) would run `sendNetworkDenied` → `blockEvents.record` + `networkDenialObserver` (`localhost-guard.ts:368-391`): probe noise and an operator-prompt amplifier.

### D2 — Pure pass core, telemetry stays on guard paths
Split `hasNetworkPassCondition` (`localhost-guard.ts:432-464`) into:
- **exported** `evaluateNetworkPass(request, { readTrusted, localToken, localTrust })` → `{ passed: "local" | "strict-exception" | "token" | "auth" | "trusted" | null, trustedList?: string[] }` — **pure**: no `noteTrustedList`, no `noteNetworkOnlyAdmission`, no request mutation. Same ordered arms as today (`:432-464`), including the strict bare-local observe / `/v1/*` model-proxy exception computed from the request. `trustedList` is set iff the core called `readTrusted()`.
- No health-specific override: the strict exception requires `isGenuinelyLocal` (`:82-83`), and every genuinely-local caller is either diverted to `localProof` first (D3, `needsLocalProof`) or admitted by an earlier arm (proof / local token, `isLocallyTrusted` `:93-100`) or by `isAuthenticated`. So the verdict on the health request equals the verdict a non-observe guarded route would reach — pinned by a test over the bare-local caller classes.
- `hasNetworkPassCondition` (same signature, both guard paths) = core + telemetry: `noteTrustedList(trustedList)` iff `trustedList` is set (as today — refusals included, so the loopback-entry warning keeps firing); `noteNetworkOnlyAdmission` iff `passed === "trusted"`. Existing guard tests (incl. `trusted-source-single-predicate.test.ts`) pin behavior unchanged.

Health gets one injected dep `readNetworkVerdict?: (request) => boolean` (true = would be refused), built in `server.ts` as a closure over the same `admissionList`, `localToken`, `localTrust` passed to `createNetworkGuard` (`server.ts:2602`), calling `evaluateNetworkPass(request, { … })` → refused iff `passed === null`. The closure reads the admission list through a 1 s TTL memo, so attacker-paced health requests cost at most one config `statSync` per second (see Risks). The raw `localToken` never enters `system-routes.ts`. Dep absent (hand-built test deps) → no field; production wiring is pinned by the real-server test (`createTestServer`).

### D3 — Precedence with `localProof`; evaluation order
In the health handler: `needsLocalProof(request)` true → `localProof: "required"` only (existing). Else `readNetworkVerdict(request)` true → `networkAccess`. Never both. The verdict call is wrapped `try { … } catch { /* omit */ }`, matching the handler's failure-isolation rule (`system-routes.ts:1147-1152`).

### D4 — Shape and constants
```ts
// packages/shared/src/network-denial-signal.ts (dependency-free; client value-imports)
export const NETWORK_NOT_ALLOWED = "network_not_allowed" as const;
export const GENERIC_NETWORK_DENIED_HINT = "Pair this device (Request access) or sign in.";
export interface HealthNetworkAccessField {
  networkAccess?: { error: typeof NETWORK_NOT_ALLOWED; hint: string };
}
```
`sendNetworkDenied`'s **generic** 403 body (`localhost-guard.ts:418-424`) uses both constants. The strict `local_proof_required` body (`:398-404`) is untouched and pinned byte-identical. The health field is deliberately narrower than the 403 body: no `success`, no `reason` (the generic `reason` string adds nothing a client branches on).

### D5 — Disclosure analysis
The field tells a caller whether **its own** request would be admitted. That outcome is already observable to the same caller: the WebSocket upgrade succeeds or fails, and (OAuth off) any per-route-guarded route answers 200 or 403 with the same hint. With OAuth configured, guarded routes answer `401` from the auth hook first (`server.ts` hook order: bearer → auth plugin → universal guard), so a signed-out OAuth caller newly sees the generic hint text; it names no posture ("Pair this device (Request access) or sign in."). Consequences, accepted:
- **Admission inference.** Presence differs between `pair` and a covering `legacy` list, exactly as the WS outcome and guarded routes already differ. The field's **value** is constant; it carries no mode, list entry, address, switch or knock state. The spec prohibits disclosure through the value and states that presence reveals only the caller's own admission.
- **Unrecorded validity probing.** Presenting a candidate bearer/cookie to health reveals validity, as a guarded route already does. Bearers are 256-bit random and sessions are signed JWTs; guessing is infeasible. Difference: health refusals are not recorded in `blockEvents` (guarded 403s are), so health-only probing with a small leaked candidate set is invisible to the operator. Accepted and recorded in the spec: recording would reintroduce D1's noise; WS and guarded attempts are still recorded.

Recorded as a second exception by MODIFYING "Request-access remedy is the one recorded exception to the access-posture disclosure predicate", per its own amendment rule.

### D6 — Client: read the field; credential comes from the existing fetch wrapper
`probeNetworkDenied`: on 200, `localProof` → existing; else `body.networkAccess?.error === NETWORK_NOT_ALLOWED` → `{ hint }` when `hint` is a string, `{}` otherwise. 403 path unchanged (older servers). Fetch failure or any other status → `null`.

No credential code in the hook. `installDeviceAuthFetch` (`packages/client/src/lib/pairing/device-auth.ts:470-495`, installed by `installFetchWrappers`, `lib/api/install-fetch-wrappers.ts`) already attaches to every `/api/*` request the bearer of the request's **own** origin (identity token same-origin only), never another origin's. The hook's default `globalThis.fetch.bind(globalThis)` (`useNetworkDenied.ts:72`) resolves the wrapped fetch at effect time, so a paired browser on a cross-origin active server is judged as itself. An explicit `Authorization` header would bypass that origin scoping (`headersWithBearer` never overrides a caller header) and break rotation — rejected. Credential-failure cases: see D7.

`checkAccess` (`packages/client/src/lib/server-route-check.ts:67-84`), the other `/api/health` consumer, is deliberately **unchanged**: mapping the field to its `"network-not-allowed"` value would make the server-selector row non-clickable (`ServerSelector.tsx:785-809`) — removing the in-app path to that server's `/pair?request` — and show its "Add it to that server's trusted networks" copy (`:229-238`), which is wrong in `pair` mode and forbidden by the banner requirement. A pairing-aware selector state is a follow-up.

### D8 — Session tagging on health by pathname
`auth-plugin.ts:553` compares `request.url === "/api/health"` exactly, so `/api/health?x` leaves a signed-in caller untagged and would yield a false field. Change the compare to exact equality on the query-stripped path: `request.url.split("?", 1)[0] === "/api/health"` (the idiom the same file uses for CSP sinks). No prefix match: `/api/healthcheck`, `/api/health/x` stay untagged. A trailing-slash `/api/health/` does not reach the health handler (Fastify default `ignoreTrailingSlash: false`), so it needs no tagging. Tagging only — health still never refuses.

### D7 — Which callers can see the field
- WS refused + REST refused (the #1082 caller): field present → banner. Correct.
- `auth.bypassUrls` caller: universal hook admits REST, but per-route guards and `authorizeWsUpgrade` refuse (no `bypassUrls` handling), so the socket is refused and the client is `offline`. Field present → banner. Correct: the dashboard cannot connect.
- `auth.bypassUrls`-covered REST path: the universal hook admits it, the per-route guards and WS do not; the verdict follows the pass predicate (refused). Consistent with the WS outcome that drives the banner.
- Sign-in method configured (any usable OAuth provider **or** passkeys enabled — the auth plugin registers its hook unless `providerRegistry.size === 0 && !passkeys.isEnabled()`, `auth-plugin.ts:273-276`), signed-out remote caller: field present, but `/auth/status` → `authenticated:false` → `auth_required` → the `/login` redirect (`login-session.ts:166-169`, `App.tsx:527-531`; `/login` renders `LoginPage`, not `App`). The redirect is unchanged by this change; during the transient loaded-app `auth_required` frame the denied surface may render before the redirect lands (it already can for `localProof`). Request access on the login page is a non-goal (follow-up).
- Revoked, superseded-after-grace or cookie-expired device credential: `/api/health` never refuses and such credentials fall through unauthenticated (`bearer-auth.ts:111-137`), so the field is present → Request access. Intended: that browser is genuinely not admitted and re-pairing is its remedy (today it loops on "Disconnected / Retrying"). A presented expired `Authorization` bearer gets `401` → `null` → the wrapper's `handleBearerExpired`; the next probe sees the field.
- Paired browser, cross-origin active server, transient outage: probe carries the bearer (D6) → admitted → no field → "Disconnected / Retrying". Correct.
- Admitted callers: the socket connects, the hook does not probe, and the field is absent anyway.

## Risks / Trade-offs

- **Hot path — accepted, bounded deviation.** Today an unauthenticated non-local health request does no config read (all reads sit behind `canDiscloseAccessPosture`, `system-routes.ts:1169-1212`; the instance id was hoisted out of the handler for the same reason, CodeQL `js/missing-rate-limiting`). The verdict adds a config read for that caller class only (local, local-token, authenticated callers short-circuit first). The 1 s TTL memo in the verdict closure (D2) caps it at one `statSync` per second regardless of request rate; parse only on file change. Budget (asserted deterministically, no wall-clock threshold): ≤ 1 config `statSync` per second from the verdict for unauthenticated remote callers, 0 for local / local-token / authenticated callers (`performance-optimization`). Per-route guards already do the same read per request for the same callers, uncapped.
- **TTL staleness.** A trust-mode or list change reaches the health verdict ≤ 1 s later than the guards. Only the banner's choice is affected, and the hook re-probes every 10 s.
- **WS vs REST predicate divergence.** The verdict is the REST pass predicate. `authorizeWsUpgrade` is parallel, not shared. Tests pin agreement for the canonical caller types (unpaired remote, device cookie, session, local, local token, trusted legacy); unifying the two is out of scope.
- **Connecting-window flicker.** The hook does not probe in `connecting`, so "Offline" can show briefly before "Network not allowed". Pre-existing for the `localProof` path; unchanged.
- **Older server / newer client**: field absent → current behavior. **Newer server / older client**: field ignored.

## Migration

None. Additive field.
