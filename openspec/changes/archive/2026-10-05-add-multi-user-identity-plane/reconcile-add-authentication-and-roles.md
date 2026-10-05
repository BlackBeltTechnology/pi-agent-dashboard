# Reconcile — `add-multi-user-identity-plane` ↔ initiative `add-authentication-and-roles`

Status: **for ruling** (no task is checked off yet; nothing implemented).
Read this before §1 of `tasks.md`.

> **HISTORICAL BANNER — kept verbatim, not rewritten (design.md D20).** This file records the
> round-1 reconcile against initiative `add-authentication-and-roles`. Its "current proposal" columns
> (§2, §3, §5) describe the pre-D16/D18/D19 design and are **not** the current model. The authoritative
> current model is `proposal.md` + `design.md`, whose **D20** fixes the deployment: the browser
> frontend is the user's own independent application; the dashboard is a backend resource server only;
> a custom independent server plugin owns login/UI/callback/logout (no BFF, no proxy, no global
> cookies, no new production IdP, no cross-origin trust). Sections below are historical record and are
> not updated to D20.

## RULED so far

- **R-G3 (activation) — `identity.mode` is removed.** There is no `legacy | multi-user` enum and no
  "preserve single-user" mode. The entire identity + enforcement plane is **active only while the
  resolver plugin is enabled**; with the plugin off the dashboard behaves exactly as it does today —
  no principal, no owner equality, no ticket-identity requirement, no fan-out gating, **no auth**.
  "Default-inert" is achieved by *plugin absence*, not a config flag. Cascade:
  - `design.md` D1 is deleted; every "in multi-user mode …" clause re-reads as "while the resolver
    plugin is active …".
  - `tasks.md` §2.1 (thread `identity.mode`) is dropped; §2.2 readiness becomes "if the resolver
    plugin is enabled it must be configured (issuer+audience) or it resolves nothing"; §2.3 /
    D8 (`auth.providers` conflict) becomes "the resolver plugin and the legacy `auth.providers`
    cookie connector are mutually exclusive — enabling both is a startup error"; §11.1
    (legacy default-inert regression) becomes "plugin-disabled regression = byte-for-byte today".
  - Enforcement is fail-closed **only when the plugin is on**: with it on, a protected route/socket
    with no principal is refused; with it off, nothing is gated.
**All rulings decided (2025 reconcile):**

- **R-G1/G2 (packaging + override).** The Keycloak resolver ships as a **new bundled plugin**
  `packages/keycloak-resolver-plugin` (manifest id `keycloak-resolver`), **default-enabled**, added to
  `BUNDLED_PLUGINS` (pinned by `bundled-plugins-complete.test.ts`). Core imports nothing
  Keycloak-specific. **Override** = a different trusted plugin, with the bundled default turned off via
  `plugins.keycloak-resolver.enabled: false` (repo-idiomatic disable) + the override trusted by name.
- **R-G4 (two independent plugin roles).** *Resolver on* ⇒ principals resolved **and owner equality is
  unconditional** (open-a-session gating needs no policy plugin). The `authorize()` **host access
  policy is a SEPARATE optional plugin**: present ⇒ it gates only **non-session** host resources
  (event fan-out predicate, workspace/terminal/system roads, bootstrap disclosure); **absent ⇒ those
  stay ungated**. The resolver never implies a policy; the policy never authenticates.
- **R-G6 (client plane in THIS change).** Add the browser topology-B plane here: PKCE token
  acquisition, `Authorization: Bearer` on REST, browser-scope ws-ticket mint bound to the principal,
  heartbeat reply. New capability spec `browser-principal-client`.
- **R-G11 (E2E in THIS repo).** Build the harness: local Keycloak + seeded realm fixture + a fixture
  trusted policy plugin + a token-minting helper, driven by Playwright (two users).
- **R-G12 (conditional full DPoP).** Keep `AuthContext.dpop` + D6a canonical `htu`. Server validates a
  proof **only when `token.cnf.jkt` is present** (reject on any proof failure); **absent ⇒ plain
  bearer**. Client mints proofs when the realm issues bound tokens; **demo realm ships DPoP off**,
  flip on later with no code change.
- **R-G5 (amend the initiative docs).** Amend SITUATION §3/§13 and RESEARCH-SYNTHESIS §6.3 to
  topology B in the invoice-bot worktree (separate task, per SITUATION §10.1).
- Out of scope (recorded, not built here): items 28/29 canonical store key (plugin-owned, downstream);
  items 45–47 RP-initiated logout/session-destroy (browser owns LEG 4 under B; §9.4 expiry-close is
  the host equivalent); §8.4 command/OpenSpec bootstrap gating beyond disclosure (fold under G4 policy
  only where a resource is host-owned).

## 0. Sources, and which one wins

| Source | Role | Authority |
|---|---|---|
| `invoice-bot-project/…/AUTH-FLOW.md` §9 | DECIDED — topology B resolved by a plugin | **Winner** over SITUATION §3/§5 items 1&4 and over OAUTH-PIPELINE §2 |
| `…/SITUATION.md` | consolidated current-state + division of labour | §3/§13 predate the topology-B ruling → stale |
| `…/OAUTH-PIPELINE.md` | ordered build list, 47 items / 8 phases | Items are product + host + ops mixed; §2 marked SUPERSEDED |
| `…/RESEARCH-SYNTHESIS.md` | cross-layer findings, owner contract, open decisions | Owner contract (§3) is binding; §5 decisions partly closed |
| `…/findings.md`, `initiative.yaml` | round-1 record (`verdict (c)`) | Historical; explicitly superseded by AUTH-FLOW §9 |

The binding statement of the end goal is **`AUTH-FLOW.md` §9** + **`RESEARCH-SYNTHESIS.md` §3 (enforcement contract)**.

## 1. The end goal (initiative, decided)

### 1.1 Topology B is fixed

The browser is a **public OIDC client**: it runs Authorization Code + PKCE, **holds the tokens**, and
presents `Authorization: Bearer <JWT>` on every call. The dashboard becomes an **OAuth resource
server** and re-validates the bearer per request (JWKS, RS256, `iss`, `aud`, `azp`, `exp`).

### 1.2 Layering rule (AUTH-FLOW §9) — who may own what

| Layer | Owns | Does **not** own |
|---|---|---|
| **Core** (upstream `develop`) | the principal-resolution **hook**, the `(iss, sub)` shape, fail-closed default, **ordering** | any knowledge of Keycloak, JWKS, or token formats |
| **Default auth plugin** ("ships with the dashboard") | B3 = JWKS/RS256/`iss`/`aud`/`azp`/`exp` validation; B4 = disambiguating an already-occupied `Authorization: Bearer` vs opaque paired-device tokens | the product meaning of the principal |
| **Override plugin** (optional) | an entirely different resolution scheme (other IdP, mTLS, opaque introspection) | — |
| **invoicebot plugin** | product authorization from the principal (live routed approver set, atomic authorize+mutate, server-stamped actor) | authenticating anyone |
| **Dashboard (host) besides the seam** | **session-owner equality** — who may *open* a session | approval authority — owner equality must never imply "may approve" |

Decision 3 verbatim: *"The default resolver is a plugin that ships with the dashboard, and is
overridable by another plugin. Default behaviour must be present out of the box, not assembled by
every deployment."*

### 1.3 The four host changes (SITUATION §5), as amended by topology B

| # | Change | Status under B |
|---|---|---|
| 1 | Thread real `iss`+`sub` through `fetchUserInfo`→callback→`signToken` | **reframed** — the cookie connector is not the identity source under B |
| 2 | `request.principal` + decorator, resolved via a **pluggable hook** | **unchanged — the load-bearing change** |
| 3 | Bind the principal to the browser WS + **targeted** send | **unchanged** (AUTH-FLOW §8, changes 12–16) |
| 4 | One identity accessor for plugin routes | **unchanged** |

### 1.4 The WebSocket plane (AUTH-FLOW §8) — unconditional in either topology

| # | Change |
|---|---|
| 12 | ticket mint binds the principal `(iss, sub)`, not only a route scope |
| 13 | `ws.principal` attached at upgrade — the socket stops being anonymous |
| 14 | owner equality on **subscribe and replay** |
| 15 | `broadcastToPermitted` + a plugin `canSee(principal, resource)` predicate replaces global `broadcast()` |
| 16 | browser-plane heartbeat + close the socket when the underlying session ends |

Change 15 **cannot** be solved plugin-side: `registerBrowserHandler` hands the plugin `ws: unknown`
and the broadcast function is global by construction. Host owns the send; plugin owns the predicate.

### 1.5 What the initiative explicitly left open (not settled)

- Hook **ordering/precedence** — how an override displaces the default; what happens on two overrides.
- **Registration timing** — plugins load after core registers its hooks; "not yet established that the
  current load order permits that. This is the first thing an implementation explore has to answer."
- **B4 disambiguation order** — JWT before or after the opaque paired-device lookup.
- Ownerless sessions (decision 3) · automation/service principal (decision 4) · actor schema (5) ·
  client naming · cross-origin credential mode.
- Issuer must be **pinned** (`KC_HOSTNAME`) before the first `(iss, sub)` is persisted.

## 2. What the current proposal design says

`identity.mode: legacy | multi-user` (default `legacy`, inert) with:

- **D2** — resolver-dispatch `onRequest` hook at a **fixed position**: after `registerBearerAuth`,
  before `registerAuthPlugin`, reading a mutable registry so plugin load order is irrelevant.
  Device bearer first → resolver chain → legacy cookie. Claim sets `principal` + `expiresAt` +
  `isAuthenticated`; `reject` → 401; `null` → continue.
- **D4** — trust grant: registration allowed only for the **bundled dashboard resolver** or a plugin
  named in `identity.trustedResolverPlugins`. Ordering `(manifest.priority ASC, pluginId ASC)`,
  first-claim-wins, duplicate registration from one plugin fails. `manifest.priority` is *not* trust.
- **D5** — three-valued outcome (`claim` / `null` / `reject`); timeout 2000 ms (100–5000);
  core's throw→`null` is an outermost safety net, not the resolver's error policy.
- **D6/D6a** — curated `AuthContext {method,url,authorization?,cookie?,dpop?,isAuthenticated,ip}`;
  canonical `url` (query/fragment stripped) for DPoP `htu`.
- **D7** — Keycloak resource-server validation: config-seeded (`issuer`, `audience` required;
  `authorizedParty`, `jwksUri`, `clockSkewSeconds`, `networkTimeoutMs`, `allowInsecureHttp`);
  discovery + coalesced JWKS cache; ownership disambiguation (opaque/foreign-`iss` → `null`,
  own-`iss` failure → `reject`); RFC 9068 RS256; **DPoP proof validation when `cnf.jkt`**;
  `email` only when `email_verified`.
- **D8** — in `multi-user` mode a non-empty `auth.providers` is a startup error.
- **D9** — exactly one `authorize({principal, action, resource})` from
  `identity.trustedPolicyPlugin`; timeout 500 ms (50–2000); deny on missing/false/throw/timeout/
  non-boolean + structured audit event.
- **D10** — **every** core HTTP route classified `public` | `device` | protected `{action,resource}`;
  every browser WS bootstrap frame and inbound message type classified; a catch-all guard denies
  unclassified `/api` routes in multi-user mode; coverage asserted by test.
- **D11** — `principalOwner {iss, sub}` persisted; assigned only via browser `spawn_session`,
  host HTTP spawn, or the trusted owned-spawn API; ownerless sessions invisible to humans.
- **D12/D13/D14** — identity-bearing ticket mandatory for browser upgrades; socket closed at
  `principalExpiresAt`; transport-only heartbeat; one road per frame; policy-gated fan-out.

Read against §1: the proposal is **right about the core seam** (D2/D5/D6 answer three of the
initiative's open questions) and **materially wider and differently shaped** than the initiative asked
in four places.

## 3. Alignment

| Initiative requirement | Current proposal | Verdict |
|---|---|---|
| Core exposes only a hook + `(iss,sub)` shape + fail-closed + ordering | D1/D2/D5/D6 | **MATCH** |
| Core knows nothing of Keycloak/JWKS/token formats | Keycloak logic sits in a "bundled dashboard resolver / module"; `design.md` Context calls it "dashboard functionality"; Impact says "plugin/module" | **DIVERGE** — must be a **plugin package**, not core |
| Default resolver = plugin that ships with the dashboard | unspecified packaging; `getPluginConfig()` in §5.1 implies a plugin but nothing declares or bundles one | **DIVERGE** |
| Default is **overridable** — "an override displaces the default" | priority-ordered **chain**, trust-granted, first-claim-wins; the default still runs whenever the override declines | **DIVERGE** (defensible; must be recorded as the answer to a question the initiative left open) |
| Principal handed to the invoicebot plugin; plugin does product authorization | host `HostAccessPolicyFn` + exhaustive route/message classification (§7) | **OVER-BUILT** — the seam is justified for fan-out + disclosure, not as a host authorization plane |
| Dashboard owns session-owner equality; never implies approve | §6, §8.1–8.3 | **MATCH** |
| WS 12: ticket binds principal | §9.1 | **MATCH** |
| WS 13: `ws.principal` at upgrade | §9.3 | **MATCH** |
| WS 14: owner equality on subscribe **and replay** | §8.3 | **MATCH** |
| WS 15: `broadcastToPermitted` + plugin predicate | §10.1–10.3 | **MATCH** (predicate is the host policy's `{action,resource}` — same shape, different name) |
| WS 16: heartbeat + close on end | §9.4/§9.5 (close at token `exp` + transport heartbeat) | **MATCH** (session-end close approximated by token expiry) |
| Issuer pinned + exact `iss` match | §11.3 + KC spec | **MATCH** |
| B4 order vs opaque device bearer | D2: device → resolver chain → cookie | **MATCH** (answers an open question) |
| Hook ordering/registration timing | D2 fixed position + mutable registry | **MATCH** (answers an open question) |
| "default behaviour present out of the box, not assembled by every deployment" | multi-user mode requires operator-set `trustedResolverPlugins` + `trustedPolicyPlugin` | **DIVERGE** for the resolver (bundled must be trusted without config); **INHERENT** for the policy |
| B1/B2 — browser runs PKCE, holds tokens, sends bearer, mints the ticket | **no client tasks anywhere in §1–§11** | **MISSING — blocking** |
| 12–16 reachable end to end | §9.2 refuses cookie-only browser upgrades | **MISSING** without the client work |

## 4. Divergences and gaps, ranked

### G1 — The bundled Keycloak resolver must be a *plugin*, not core (blocks the layering rule)

AUTH-FLOW §9 is unambiguous: *"B3 and B4 … do not go into dashboard core as hard-wired logic. They
become a plugin. Core supplies only the seam."* The proposal's own package inventory backs this
loosely ("Bundled dashboard plugin/module"), and implementation §5.1 says `getPluginConfig()` — which
only exists on a plugin context.

**Proposed**: a bundled plugin package (e.g. `packages/keycloak-resolver-plugin`, manifest id
`keycloak-resolver`), default-enabled, added to `BUNDLED_PLUGINS` in
`packages/electron/scripts/bundle-server.mjs` (pinned by
`packages/shared/src/__tests__/bundled-plugins-complete.test.ts`). Core imports **nothing**
Keycloak-specific; its only awareness is "a trusted resolver is registered".

### G2 — Override semantics: chain vs displacement

The initiative requires the default to be **overridable**, and lists "how an override displaces the
default" as open. D4 answers it with a priority-ordered chain plus a trust grant — a legitimate
answer, but not displacement: an override that declines (`null`) falls through to the bundled
resolver, which is exactly the "assemble the default anyway" behaviour decision 3 warns about when an
operator deliberately installed a different scheme.

**Options**: (a) keep the chain, record it as the ruling; (b) literal displacement — a trusted
override disables the bundled resolver (order/trust identical, but the chain is exclusive);
(c) chain + the repo-idiomatic escape hatch (`plugins.keycloak-resolver.enabled: false`) with the
override trusted by name. (c) is the smallest change and matches how every other plugin is turned off.

### G3 — `identity.mode` welds "topology B on" to "host authorization on" — RULED: mode removed

**Ruling: there is no mode enum.** The plane activates on the resolver plugin being enabled and is
otherwise fully absent (no auth). See "RULED so far" at the top.

Residual question this exposes (now folded into G4): the resolver plugin (authentication) and the
access-policy plugin (host dispatch authorization) are *two different plugin roles*. "The plugin is
turned on" cleanly governs **authentication** (resolver on ⇒ principals resolved). It does not by
itself decide whether host **dispatch gating** (owner equality is unconditional once there are
principals; the `authorize()` policy is separate) is required. G4 settles that.

### G4 — Host access policy vs "the plugin authorizes"

AUTH-FLOW §9's layer table gives the host: the hook, the shape, fail-closed, ordering, and (from
§8/RESEARCH-SYNTHESIS §3) *owner equality*. Fan-out (change 15) legitimately needs a host-side
predicate — the host does the send. §8.4 (bootstrap disclosing another principal's paths, branches,
terminals) is also real. But the proposal's framing — *"product authorization lives behind the single
access-policy seam"* — reads as the dashboard owning authorization, which contradicts
SITUATION §3 ("the plugin authorizes"), RESEARCH-SYNTHESIS §4, and OAUTH-PIPELINE §0 (which keeps
authentication, session ownership and authorization as three separate questions).

**Proposed**: restate the seam as a **host resource-dispatch gate** (may this principal be *sent*
this host-owned resource), explicitly **not** the product authorization model; product authorization
stays in the plugin, evaluated live and atomically with the mutation (OAUTH-PIPELINE items 34–37).

### G5 — The durable record contradicts the ruling (must be amended, in the other repo)

- SITUATION §3: *"The dashboard authenticates. Its existing Keycloak connector is the product's
  login."* — topology A.
- SITUATION §13 DoD 1: *"configured as `auth.providers.keycloak`."* — topology A.
- SITUATION §5 changes 1 & 4 — written for the cookie leg.
- RESEARCH-SYNTHESIS §6.3 — concludes A is the smaller move.
- OAUTH-PIPELINE §2 — already marked SUPERSEDED by §9; §6 decision 1 CLOSED as B.

The proposal sides with **B** (D8 rejects `auth.providers` in multi-user mode). That is correct per
§9 and must be *recorded* rather than smoothed over — SITUATION §10.1 asks for exactly this.

### G6 — No client-plane work at all (blocking for §8/§9)

`packages/client/src` is built for topology **A**: `useAuthStatus.redirectToLogin()` navigates to
`/auth/login`; `useWebSocket` mints a ticket **only** for a paired-device bearer ("unpaired browsers
skip ticketing (cookie/loopback path unchanged)") because `installDeviceAuthFetch` only ever attaches
a *device* bearer from `localStorage`. There is no PKCE, no token store, no human bearer, and no
heartbeat reply.

So in `multi-user` mode the shipped web client: has no bearer to present, cannot mint a
browser-scope ticket, is refused at upgrade (§9.2), and cannot answer the §9.5 heartbeat. The
proposal contains no task that fixes this. RESEARCH-SYNTHESIS §6.2 independently confirms the UI sends
no credentials in either plane and that today's green E2E passes *because loopback bypasses the very
gates the demo must exercise*.

### G7 — Item 27 (`spawnToken` → owner correlation) is absent

§6.2 names three spawn roads but not the correlation timing. OAUTH-PIPELINE item 27 and
RESEARCH-SYNTHESIS §3 require the owner be filed **before** awaiting the spawn, following the
`pending-plugin-ref-registry` precedent (which does token-exact correlation and explicitly rejects
`cwd` as ownership).

### G8 — Items 28/29 (canonical session key) are absent

Canonical store key is `cwd + NUL + invoiceId -> sessionId` with no user dimension, and the Ask
session key is a **global** `ib:ask:session` that survives logout and is adopted by the next user
(RESEARCH-SYNTHESIS §6.1). Items 28/29 change that key. Owner-equality filtering (§8.2/8.3) hides the
leak at the host boundary but does not fix the store key.

**Proposed**: downstream (the store is plugin-owned) — record as an explicit non-goal here with the
pointer, so the product change inherits it as a hard prerequisite.

### G9 — Service principal for automation (item 25) is thin

§11.1 asserts automation sessions stay ownerless; it does not state whether host-internal automation
roads are principal-gated (they are not — they are in-process, not HTTP). AUTH-FLOW/OAUTH-PIPELINE ask
for an explicit **non-human principal policy** rather than an inferred one. Needs one explicit
sentence, not new code.

### G10 — Items 45–47 (RP-initiated logout, destroy session, close owned sockets) are out of scope

Under B the browser owns LEG 4 and calls `end_session_endpoint` itself; the dashboard is a resource
server with no session store to destroy. §9.4's close-at-`principalExpiresAt` is the closest host-side
equivalent and should be stated as such.

### G11 — §11.2 (docker Keycloak, two users) is not executable in this repo as written

The `pi-agent-dashboard` docker harness has no Keycloak service, no seeded realm, no product plugin,
and — because `multi-user` mode refuses to boot without a trusted policy plugin — no policy provider.
SITUATION §11 adds: the realm JSON lives in the *other* repo (`.pi/dev/keycloak/realm-invoicebot.json`),
no container runs, the realm needs reseeding to drop group-based routing, and the product's E2E image
clones from **GitHub** branches, so unpushed work is invisible to it and a green gate would prove
nothing. `test-plan.md` already calls the harness addition "a prerequisite".

### G12 — Fully extra work not requested by the initiative

- **DPoP proof validation** (§5.5: proof JWS verification, `jwk` thumbprint vs `cnf.jkt`, `htm`,
  `htu`, `ath`, `jti` LRU). Nothing in AUTH-FLOW / OAUTH-PIPELINE / SITUATION mentions DPoP or
  `cnf.jkt`. The `AuthContext.dpop` field is cheap insurance; the validator is the single largest
  unit of untasked crypto in §5.
- **§8.4** — policy-gating OpenSpec/branch/terminal/system bootstrap and commands.
- **Exhaustive §7.3/§7.4 classification** of every core route and WS message.

## 5. Open questions the proposal *does* answer (should be recorded as such)

| Initiative open question | Proposal's answer |
|---|---|
| Hook ordering / how the override takes precedence | D2 fixed hook position + D4 `(priority, pluginId)` ordering |
| Registration timing (plugins load after core hooks) | D2 — core registers the hook at a fixed position and reads a mutable registry; plugin load order is irrelevant |
| B4 disambiguation order | D2 — device bearer first, then resolvers, then the legacy cookie branch |
| Ownerless legacy sessions | D11 — invisible to humans; adoption is a deliberate operator action |
| Actor schema / product authorization | out of scope — belongs to the invoicebot plugin (correct per the layering rule) |

## 6. Proposed artifact changes (once ruled)

1. **`proposal.md`** — add a `## Reconcile` section naming AUTH-FLOW §9 as the authority and recording
   G5; split "What Changes" into *host identity plane* / *host dispatch plane* / *client plane*;
   restate the Keycloak resolver as a **bundled plugin**; add a non-goals list (G8/G10, G12 per ruling).
2. **`design.md`** — D4 → the ruled override rule (G2); D7 → resolver ships as a bundled plugin
   package, core imports nothing Keycloak-specific (G1); D9 → restated as a host resource-dispatch
   gate, not product authorization (G4); new D15 → `identity.mode` vs dispatch-policy split (G3);
   new D16 → the client plane; D5/D7 → DPoP per ruling.
3. **`tasks.md`** — add §0 (bundled plugin package + `BUNDLED_PLUGINS` + invariant test); add the
   §6.2 `spawnToken` correlation step (G7); add a client section; rewrite §11.2 per the E2E ruling;
   mark the out-of-scope items explicitly instead of leaving §1–§11 silent about them.
4. **`specs/host-access-policy/spec.md`** — scope the capability to host-owned resource dispatch and
   delete the implication that the host owns product authorization.
5. **`specs/`** — likely a new `browser-principal-client` capability if the client plane lands here.
6. **initiative repo** (separate worktree, ask first) — amend SITUATION §3/§13 and RESEARCH-SYNTHESIS
   §6.3 to topology B, per SITUATION §10.1.

## 7. Rulings needed

See the batch question accompanying this file. Until they are answered, §1 of `tasks.md` is the only
section that can be implemented without risking rework: the identity **types and config shape** are
identical under every option above.
