## Context

See proposal.md — Why. Current state:

- `packages/server/src/auth/operate-required.ts` builds every `operate_required` body. `describeOperateRefusal(request, loginAvailable)` (`:63-80`) derives `reason` + `remedies`. `reason` is `tier-too-low` for a device **or** session below `operate` (`:68-70`). `re-pair` is added only for `authVia === "device"` (`:76`). `use-host` is derived from `request.ip` (`:75`). The canonical order lives in `packages/shared/src/operate-required.ts:13-16` (`OperateRemedy`, `OPERATE_REMEDY_ORDER`). Callers: `vault/vault-routes.ts:139` and `services/routes.ts:58`, both wired in `server.ts:2554-2563` with a `loginAvailable` thunk.
- Knock admission is `packages/server/src/pairing/knock-admission.ts` `admitKnock()` (`:137-166`). Gate 1 is Host admission (`:139-141`). Gate 2, `knock_not_lan`, refuses any forwarding header or `!isOnLinkPrivate(peer, interfaces)` (`:143-145`). Both run before the operator switch (`:147`). The route builds the input at `routes/pairing-routes.ts:300-309` (`peer: request.socket.remoteAddress`, `host: headerString(request.headers.host)`, `interfaces: deps.getLanInterfaces?.() ?? []`). The interface list comes from `createLanInterfaceProvider` (`auth/localhost-guard.ts:989`), instantiated inline at `server.ts:2864`.
- Verified credentials: `authVia` is set by bearer (`auth/bearer-auth.ts:100`), session (`auth/auth-plugin.ts:518`) and principal (`identity/resolver-hook.ts:80,119`). A verified local proof or local token sets no `authVia`. Auth passes it via `hasLocalCredential(request.headers)` (`auth/auth-plugin.ts:481`, `auth/local-credential.ts:95-98`).
- Client: `components/settings/vault/OperateRequiredCallout.tsx` renders one row per known remedy. `VaultSection.tsx:146-160` stores only `operateRemedies`, and `:247` passes `remedies/busy/onRetry`. `fetchVault` reads `getApiBase()` when it is called (`lib/vault/vault-api.ts:131`). The banner's target rule is in `components/connectivity/ConnectionStatusBanner.tsx:67-70`. The i18n test requires every literal `vault.*` key in `lib/i18n-en-source.json` and enumerates the dynamic remedy keys (`packages/client/src/__tests__/i18n.test.ts:283-299`).
- `trust-and-credential-boundaries` "Opt-in local proof for loopback trust" (`openspec/specs/trust-and-credential-boundaries/spec.md:45`) holds "Access-posture disclosure keeps its existing predicate". Two in-flight changes rewrite that requirement: `close-loopback-legacy-window` and `fix-pairing-approval-credential`. A third, `retire-trusted-networks-bypass`, ADDs a configured-list branch to knock eligibility (`openspec/changes/retire-trusted-networks-bypass/specs/lan-knock-pairing/spec.md:3-4`).

## Goals / Non-Goals

**Goals:**
- One source of truth for "would the knock's gates before the operator switch pass for this request". The knock route and the remedy both use it, so the remedy cannot drift from the knock, including when a later change alters knock eligibility.
- The remedy's presence is derivable by the same caller from the public knock route. That equivalence is the whole disclosure argument.

**Non-Goals:**
- Any change to who is admitted or refused, to the knock route's behaviour, or to the `/pair?request` landing.
- A remedy on the pairing-approval 401 (`fix-pairing-approval-credential` owns that vocabulary).
- Plugin routes and plugin client bundles. `packages/obs-studio-plugin/src/server/routes.ts:95` already sends a remedy-less `operate_required`; that gap predates this change and is out of scope.

## Decisions

### D1 — Extract the knock's pre-switch gates: `knockPeerInput()` + `knockPeerGate()`
`pairing/knock-admission.ts` gains two exports:
- `knockPeerInput(request) → KnockAdmissionInput` builds `{ peer: request.socket.remoteAddress, headers, host: headerString(request.headers.host) }` (moving `headerString` normalisation from `pairing-routes.ts:76`). This is the one input builder; both the route and the D2 thunk call it.
- `knockPeerGate(input, state: Pick<KnockAdmissionState, "hostAdmission" | "interfaces">) → "host_not_admitted" | "knock_not_lan" | null` holds today's gates 1–2 verbatim.

- `knockPeerState(deps: KnockPeerDeps) → Pick<KnockAdmissionState, "hostAdmission" | "interfaces">`, where `KnockPeerDeps = { hostAdmission: () => HostAdmissionOptions; getLanInterfaces: () => LanInterface[] }`. This is the one gate-state builder.

`admitKnock()` calls `knockPeerGate` first. `pairing-routes.ts` uses `knockPeerInput` and spreads `knockPeerState(deps)` into its `admitKnock` state. `server.ts` builds a single `knockPeerDeps` object and passes it to the pairing routes and the D2 thunk. A later change to knock eligibility (e.g. `retire-trusted-networks-bypass`'s list) extends `KnockPeerDeps` + `knockPeerState` + `knockPeerGate` only; both call sites follow without edits. The knock's behaviour and refusal order are unchanged; existing `knock-admission` / `pair-request-route` tests guard this.
*Alternative:* re-implement "private + on-link + no forwarding header" in `operate-required.ts`. Rejected: two copies of a security predicate drift.

### D2 — Remedy predicate injected like `loginAvailable`
`SendOperateRequiredOptions` gains optional `requestAccessAvailable?: (request: FastifyRequest) => boolean`. `describeOperateRefusal` adds `request-access` iff both hold:
- `marked.authVia === undefined`. Revoked or invalid bearers leave it unset, so they qualify. Low-tier devices and refused principals (`vault-routes.ts:119-128`) do not.
- `requestAccessAvailable?.(request) === true`.

When the option is absent the remedy never appears, so unit tests and future callers opt in explicitly; unit tests pass a stub function. `server.ts` builds one thunk and passes it to the vault and services route deps:
```ts
(req) => !hasLocalProof(req.headers, localTrust)          // verified local token OR local-proof cookie (auth/local-proof.ts:73-76)
  && knockPeerGate(knockPeerInput(req), knockPeerState(knockPeerDeps)) === null
```
`knockPeerDeps.hostAdmission` is the same `() => getHostGateCtx().admission` getter already passed to the pairing routes (`server.ts:2842-2871`). The local-credential check sits in the thunk because only `server.ts` holds `localTrust`. The peer is the raw socket address (knock D4).

**Accepted gap:** on a trusted-source peer, auth returns before verifying a session cookie (`auth-plugin.ts:507` precedes `:510-518`), so such a session holder carries no `authVia`. The shipped `reason` already reports them as `no-credential`, and they now also get `request-access`. A knock would give them a device credential, which is harmless and discloses nothing beyond the knock route. Verifying the cookie in the refusal path would duplicate auth logic for no security gain.
*Alternative:* gate on `reason === "no-credential"`. Rejected: that reason also covers a refused identity principal and a verified local credential, neither of which needs a knock.

### D3 — Host admission is part of the rule (tightening of knock D10)
D10 named only `knock_not_lan`. The knock checks Host admission first (`knock-admission.ts:139-141`). Including it means the remedy never points at a knock that would refuse with `host_not_admitted`. The disclosure equivalence also holds exactly: in host-gate report mode, a DNS-rebinding page learns from the refusal only what the knock route would tell it, which is that the Host is not admitted.

### D4 — One shared LAN-interface provider
Hoist `createLanInterfaceProvider({ bindHost: config.host })` to a single `lanInterfaces` instance in `server.ts`. It feeds the pairing routes (`getLanInterfaces`) and the D2 thunk: one 30 s cache, no extra `os.networkInterfaces()` per refusal.

### D5 — Order `use-host`, `re-pair`, `request-access`, `sign-in`
`OPERATE_REMEDY_ORDER` / `OperateRemedy` gain `request-access` after `re-pair`. `re-pair` and `request-access` are mutually exclusive (credential vs none). `use-host` always co-occurs, because a peer that passes the knock gates is never loopback. `sign-in` stays last.

The delta also corrects the restated `reason` / `re-pair` text to match shipped code: a sub-operate session yields `tier-too-low` without `re-pair` (`operate-required.ts:68-76`). This aligns the spec text with existing behaviour; no behaviour changes. No scenario is added for it, because for the vault that path is effectively unreachable: off-trust the tier gate refuses first (`route-tier-gate.ts:71-85`), and on trust the session is not verified (D2). It also scopes "every route" to the vault and services families, which the message table already implied. `packages/obs-studio-plugin/src/server/routes.ts:95` stays outside, as a pre-existing gap.

### D6 — Disclosure is an ADDED exception requirement with explicit precedence
The exception is a new `trust-and-credential-boundaries` requirement that opens with "Notwithstanding the sentence … in 'Opt-in local proof for loopback trust'". This avoids a MODIFIED copy of a block that two in-flight changes already rewrite, where whichever archives last would revert the other's text. The precedence clause still reconciles it with the unqualified sentence.

### D7 — Client: refusal-time base, shared `requestAccessTarget()`, link-shaped row
- `vault-api.ts` `call()` reads `getApiBase()` once at request start (`:131`) and returns it as a new `VaultResult.base`. `VaultSection` stores the refusal as `{ remedies, base: res.base }` and passes `apiBase={base}` to the callout. The link therefore targets exactly the server the refused load went to, and neither a mid-flight nor a later server switch can retarget it.
- New `packages/client/src/lib/pairing/request-access-target.ts`: `requestAccessTarget(apiBase, origin) → { href, newContext }`. It keeps the banner's exact semantics (`ConnectionStatusBanner.tsx:67-70`): an empty base or `apiBase === origin` (no normalisation) gives `{ href: "/pair?request", newContext: false }`; otherwise `{ href: \`${apiBase}/pair?request\`, newContext: true }`. The banner keeps `window.open(href, "_blank", "noopener")` / `location.assign(href)`, so its tests (`ConnectionStatusBanner.test.tsx`) stay unchanged.
- The callout row renders an `<a>`: plain `href` on the same origin, `target="_blank" rel="noopener noreferrer"` for another server. It uses the `sign-in` link recipe and icon `mdiAccountArrowRight`.
- EN copy: "If this dashboard accepts requests from your local network, you can ask for access from this device. Someone at the dashboard computer approves it by typing a code." Link text: "Request access". Keys `vault.operateRequired.request-access` and `vault.operateRequired.requestAccessLink` go in `packages/client/src/lib/i18n-en-source.json`, `packages/client/src/lib/i18n/i18n-hu.ts` and `packages/client/src/lib/i18n/i18n-zh-CN.ts`, and `request-access` is added to the dynamic list at `packages/client/src/__tests__/i18n.test.ts:298-299`.
- No mockup: this is one row in an existing, already-reviewed callout recipe.

## Reachable population

The vault and services routes run the network guard before the operate rule (`vault-routes.ts:142`). The guard admits only callers that are genuinely local, hold a local token, are a trusted source, or are authenticated (`localhost-guard.ts:390-415`). Genuinely local callers fail the knock gate (loopback), and authenticated or locally credentialed callers fail rule (a). So **the remedy reaches exactly the credential-less callers admitted by a trusted-network / bypass-host entry**. An untrusted LAN browser gets `network_not_allowed` and the banner's Request access instead. That is the intended split: the banner covers denied callers, and this remedy covers callers who are network-admitted but below `operate`.

## Coordination with in-flight changes

- **`retire-trusted-networks-bypass`** ADDs a configured-list branch to knock eligibility (live-read, both trust modes) and, in `pair` mode, stops network matches from admitting. When it lands:
  - It extends `KnockPeerDeps` / `knockPeerState` / `knockPeerGate` (D1) with the list, and the remedy follows without touching its thunk ("this remedy SHALL follow them"). If retire archives first, this change's task 2.2 builds those helpers including the list. If this change archives first, retire's knock-eligibility task edits those three symbols. Both cases are owned by a task (tasks 2.3 / 8.1).
  - In `legacy` mode, an admitted credential-less caller is in that list, so presence adds nothing.
  - In `pair` mode, credential-less non-local callers never reach `operate_required`, so the remedy does not fire; the banner covers them.
  - Scenarios are keyed to "passes / fails the knock's network-position gate". Their address examples are illustrative.
- **`close-loopback-legacy-window`** retires the raw local token. `hasLocalProof` → `hasLocalCredential` tracks whatever that change leaves as a verified local credential, so no edit is needed here. A raw token that no longer verifies becomes "no credential", which is consistent with rule (a).

## Risks / Trade-offs

- [Knock-route equivalence holds for same-origin requests] → a foreign-`Origin` POST is refused by the mutation-origin gate (`auth/mutation-origin-gate.ts:30-54`) before the knock's gates, while a foreign-origin vault GET still reaches the refusal. A foreign origin can read that GET body only if CORS admits it (`auth/cors-origin.ts` `classifyCorsOrigin`: configured, tunnel or trusted-network origins). The mutation-origin gate admits those same origins to the knock POST, which then returns the same verdict. Accepted.
- [Remedy shown, but the knock refuses with `knock_disabled`] → accepted by design (the rule must not read the switch). The copy is conditional ("if this dashboard accepts requests…"), and the landing explains `knock_disabled`.
- [After the retire change, in `pair` mode, the remedy never fires] → it effectively serves `legacy` mode, which is every upgraded install with a non-loopback trusted entry. The banner's Request access covers `pair` mode (see Reachable population).
- [`use-host` reads `request.ip` (`operate-required.ts:75`) while `request-access` reads the socket peer] → these are identical while `trustProxy` stays off (repo convention; knock D4). If `trustProxy` is ever enabled, the knock and this remedy keep the socket peer and `use-host` would need the same review. This is recorded, not changed here.
- [A header-less LAN forwarder (socat, NAT hairpin) looks on-link] → inherited from knock D3. The remedy only points at the knock, which still needs operator approval and the typed code.

## Migration Plan

Additive. No data or config migration. Older clients ignore `request-access` (the existing callout's `isKnown` filter). Rollback: drop the `requestAccessAvailable` wiring in `server.ts` and the remedy disappears. The type/order addition is inert without it, and the client row is dead code until a server sends the value.
