# Design — Harden Trust and Credential Boundaries

## Context

Five residual findings from the security-boundary audit (B5, B14, B15, B25, B4).
Plan-time verification against the tree corrected several proposal premises;
the decisions below record the resolved approach (owner-chosen options for
B14/B15/B4).

Verified facts (paths on `develop`):

- Auth files live under `packages/server/src/auth/`. Client bearer store is
  `packages/client/src/lib/pairing/device-auth.ts`.
- **The same-desktop browser never presents `X-Pi-Local-Token`.** Only the
  extension (`packages/extension/src/local-token-header.ts:23`) and IPC callers
  do. The browser is admitted by `isGenuinelyLocal`
  (`auth/localhost-guard.ts:75`). A marker-less loopback relay (`ssh -R`,
  `socat`) is indistinguishable from it at the socket level.
- `isGenuinelyLocal` has **eight** call sites: `auth/auth-plugin.ts:297`
  (`onRequest` skip), `:376` (`validateWsUpgrade`), `:456`
  (`authorizeWsUpgrade`, every WS scope), `auth/localhost-guard.ts:90`
  (`canDiscloseAccessPosture`), `:352` (`hasNetworkPassCondition`, def `:344`),
  `auth/route-tier-gate.ts:68` (tier exemption),
  `auth/bridge-ticket-eligibility.ts:70` (bridge-ticket mint),
  `routes/pairing-routes.ts:113` (operator guard).
- WS scopes: `/ws`→browser, `/ws/terminal/*`→terminal, `/live/*`→live
  (`auth/ws-ticket.ts:105-108`).
- `@fastify/cookie` is registered **only** inside `registerAuthPlugin`
  (`auth/auth-plugin.ts:176`), after an early return when no provider resolves
  (`:144-147`); `registerBearerAuth` runs before it (`server.ts:1791` vs
  `:1829`), and the auth plugin registers only when `config.authConfig` exists.
- `ensureLocalToken()` always runs at boot (`server.ts:580`).
- `plugin_emit_event` relay is generic by design (`extension/src/bridge.ts:1542`;
  archived `automation-emit-configured-event`). It has **two** server-side
  producers: `emitEventToSession` (`server.ts:3238`) and the raw
  `sendExtensionMessage` lane (`server.ts:3255`), both gated on
  `manifest.priority <= 100`; MCP denies both
  (`mcp-server-plugin/src/server/tools.ts`). `pi.events` listener inventory (grep `events.on(` in
  `packages/extension/src`): privileged — `roles:get-all|set|remove|preset-load|preset-save|preset-delete`
  + `role:resolve-model` (`role-manager.ts:253-366`), `dashboard:enqueue-followup`
  (`bridge.ts:3392`), `dashboard:plugin-message` (`bridge.ts:3404`),
  `prompt:register-adapter` (`bridge.ts:3370`), `model:resolve`
  (`provider-register.ts:1089`), `ui:invalidate` (`ui-modules.ts:196`);
  benign — `flow:rediscover`, `flow:complete` (resend lists,
  `flow-event-wiring.ts:186-187`), `flow:get-available-models` (query,
  `provider-register.ts:1096`); forwarders — `registerEventBusForwarding`
  subscribes dynamically to `forwardedBusChannels()` (`flow-event-wiring.ts:147`)
  and only relays to the dashboard (a forged `flow:complete` could finalize a
  run early; no host action). The automation caller ignores the
  boolean result (`automation-plugin/src/server/index.ts:406`).
- `config.json` has **eight** write sites, none chmod'ed:
  `shared/src/config.ts:2043`, `server/src/config-api.ts:141`, `:325`,
  `server/src/routes/plugin-config-routes.ts:38`,
  `server/src/routes/plugin-activation-routes.ts:49`,
  `server/src/auth/auth.ts:145` (persists `auth.secret`),
  `server/src/tunnel-providers/zrok.ts:150`, `server/src/server.ts:3302`.
  `loadConfig` (`shared/src/config.ts:1882`) wraps read+parse in one `try`
  whose `catch` returns defaults (`:2008-2010`). Observed `644` on the
  maintainer's install (runtime, not repo-verifiable).
- OAuth: nonce is generated (`auth-plugin.ts:63`) but never checked (`:68`);
  `?return=` read at `/auth/login` (`:189`) and `/auth/start/:provider`
  (`:206`); multi-provider picker `renderLoginPage(providers, error)` (`:80`, called `:195`) omits `return`; code exchange
  (`:229`) precedes state decode (`:248`); `reply.redirect(returnUrl)` (`:266`).
  Session JWT is signed with `authState.secret` (`:243`).
- Device bearer: `localStorage` `pi-dashboard:device-bearer`
  (`device-auth.ts:24-58`), attached same-origin to `/api/*`+`/v1/*` only
  (`device-auth.ts:62`). Bearer presence gates WS ticket minting
  (`client/src/hooks/useWebSocket.ts:270` — gates on `getApiBearer()` = identity token ?? device bearer; `mintWsTicket` `device-auth.ts:101-103`) and the
  pairing-approval skip (`components/pairing-approval/PairingApprovalHost.tsx:47` default, check `:62`).
  Server: `auth/bearer-auth.ts:35-52`. `routeTier` fails closed to `operate`
  for unlisted routes (`shared/src/route-tiers.ts:338`).

## Goals / Non-Goals

**Goals:** close B5, B25; make B14 closable by opt-in; constrain B15 without
breaking the generic relay; remove the durable bearer from JS-readable storage
for same-origin browsers (B4).

**Non-Goals:** default loopback posture change; Electron keyring bearer; WS
single-use ticket semantics; `plugin_request`/`plugin_reply`; XSS closure
(`sanitize-untrusted-rendered-content`).

## Decisions

### D0 — Hoist cookie support (prerequisite for D1, D2, D5)

Register `@fastify/cookie` once at server level, before `registerBearerAuth`
(`server.ts:~1790`), and remove the in-plugin registration
(`auth-plugin.ts:176`). Cookie parsing then works with or without OAuth
providers.

### D1 — OAuth state cookie + same-origin returnUrl (B5)

- Every redirect to an authorize URL (`auth-plugin.ts:189`, `:206`) sets
  `pi_dash_oauth_state` = `nonce.HMAC(k_state, nonce)` where
  `k_state = HMAC(authState.secret, "pi-dashboard/oauth-state/v1")` (domain
  separated from the JWT key). httpOnly, `sameSite: "lax"` (the callback is a
  cross-site top-level GET from the IdP — `strict` would drop it), `secure` as
  `pi_dash_token`, `path: "/auth/"`, `maxAge: 600`.
- Callback verifies cookie signature and nonce equality (constant-time)
  **before** `exchangeCode`. Mismatch/missing → `/auth/login?error=Invalid+login+state`,
  no code exchange, no session. State cookie cleared on every outcome.
- `sanitizeReturnUrl(raw)`: **no extra decode** (Fastify already decoded the
  query). Accept only a string that starts with `/`, whose second char is not
  `/` or `\`, has no control chars, and for which
  `new URL(raw, "http://x.invalid").origin === "http://x.invalid"`; else `/`.
  The sanitized value is what goes into `state`; re-applied at decode. Tests
  cover `//`, `/\`, `https:`, `%252F%252F` (stays a literal path).
- `renderLoginPage(providers, error, returnUrl)` — signature + call site `:195`
  — puts `?return=<sanitized, encodeURIComponent>` on each picker link.

### D2 — Opt-in `requireLocalProof` (B14)

- Top-level config `requireLocalProof: boolean` (default `false`) in
  `shared/src/config.ts` (`DashboardConfig` + defaults + parse) — top-level
  because the auth plugin is absent without providers. Default: unchanged.
- One predicate in `auth/localhost-guard.ts`:
  `isLocallyTrusted(input, ctx) = isGenuinelyLocal(ip, headers) && (!ctx.strict() || hasLocalProof(headers, ctx))`,
  `input = { ip, headers }` (the cookie is read from the raw `cookie` header,
  so it works in WS upgrade paths without Fastify decoration).
  `ctx: LocalTrustContext = { strict: () => boolean /* live config read */, localToken, proofKey }`
  built once in `server.ts` and threaded to each site. `hasLocalProof` = valid
  `pi_dash_local` cookie OR valid `X-Pi-Local-Token`.
- Sites switched (eight): `auth-plugin.ts:297,376,456`, `localhost-guard.ts:352`,
  `route-tier-gate.ts:68` (`tierRefusalFor` gains `ctx`; second caller
  `session/session-api.ts:589` updated),
  `bridge-ticket-eligibility.ts:70` (`BridgeMintInput` gains `ctx`),
  `pairing-routes.ts:113`, and the plugin-scope WS check
  `isPluginScopePeerLocal` (`server.ts:3486`) — under strict it additionally
  requires `hasLocalProof`. `canDiscloseAccessPosture` (`:90`) is **not**
  switched — disclosure, not admission (trade-off below).
- Observe exception: in `hasNetworkPassCondition` and the auth skip, under
  strict a bare genuinely-local request passes when the URL is `/api/*` and
  `routeTier(request.method, request.routeOptions.url) === "observe"`
  (`onRequest` runs after routing — same assumption as `route-tier-gate.ts`;
  unmatched route → `operate`, denied).
- Trusted entries under strict: `isTrustedSource(ip, headers, trusted, ctx?)`
  returns `false` for a loopback-range peer without proof when `ctx.strict()`
  (a `127.0.0.1` entry cannot re-admit a relay). Admission callers pass `ctx`:
  `localhost-guard.ts:357`, `route-tier-gate.ts:69`, `auth-plugin.ts:324,378,461`.
  `cors-origin.ts` (not admission) omits it. MODIFIED delta on
  `trusted-networks` "Relayed loopback requests are never trusted by network entry".
- Denial under strict carries `reason: "local_proof_required"` and a hint
  ("open the dashboard with `pi-dashboard open`"); an unmatched route under
  strict is denied 403 (fail-closed), same as today for non-local callers.
- `/v1/*` (model proxy, called by local pi processes) keeps existing admission
  (trade-off below). `/editor/*` and `/live/*` follow the predicate.
- Bootstrap (outside the auth plugin, always registered):
  `POST /api/local-proof` — admitted only by `X-Pi-Local-Token` — returns a
  one-time code (32 random bytes, 60 s TTL, single use, in-memory map with
  sweep). `GET /auth/local-proof?code=…` (under `/auth/*`, outside guard jurisdiction; registered by the server, not the provider-gated auth plugin) consumes it,
  sets `pi_dash_local` = `<id>.<expiresAt>.<HMAC(k_local, id.expiresAt)>`
  (random `id`, server-checked `expiresAt`) where
  `k_local = HMAC(localToken, "pi-dashboard/local-proof/v1")`; httpOnly,
  `sameSite: "strict"`, `path: "/"`, `maxAge` 30 days; redirects `/`. Rotating
  the local token invalidates every proof cookie.
- Launchers: new CLI subcommand `pi-dashboard open` (`server/src/cli.ts`
  dispatch `:812`) mints via the local token, prints the one-time URL to stdout
  and opens the browser; `--print` prints only (no browser); server down →
  exit 1 + "server not running" message; Electron
  (`electron/src/main.ts:336`, `:524`) loads `/auth/local-proof?code=…`
  **always** (needed by D6 in every mode; harmless when strict is off).
  Bootstrap routes are registered regardless of `requireLocalProof`.
- `ROUTE_TIERS` gains `POST /api/local-proof` = `operate`; MCP `DENYLIST`
  (`mcp-server-plugin/src/server/tools.denylist.ts`) gains it with a reason
  (`mcp-manifest-completeness.test.ts` requires both).
- Residual: the code rides a URL (history, access log); single use + 60 s TTL
  bound it.
- Alternative rejected: default-on — breaks every bare `http://localhost:8000`
  bookmark and local `curl` tooling.

### D3 — Declared-event allowlist + reserved-namespace denylist (B15)

- `ActionRegistration` (`automation-plugin/src/server/action-registry.ts:71`)
  gains `emits?: string[]`; `register()` (`:109`) rejects a `buildEvent`
  contribution lacking non-empty `emits` (the action is **not registered** —
  disappears from the dialog). `buildRunDispatch` (`engine.ts:108-133`)
  returns a new `{ kind: "refused", reason }` variant when
  `eventType ∉ emits` or `isReservedEventType(eventType)`; the dispatch caller
  (`index.ts:~400`) fails the run with that reason instead of emitting.
  `emitEventToSession`'s boolean (also `false` for offline session) keeps its
  existing handling — no overload.
- `completion.eventType` is a forwarded event the engine *listens for*, never
  emitted — not subject to `emits`.
- Flows declares `emits: ["flow:run"]` (`flows-plugin/src/server/automation-actions.ts`,
  action def; local `ActionContributionLike` interface `:34` gains the field).
- `RESERVED_EVENT_PREFIXES = ["roles:", "role:", "model:", "prompt:", "dashboard:", "ui:"]`
  + `isReservedEventType()` exported from `shared/src/protocol.ts` beside
  `PluginEmitEventExtensionMessage`. `emitEventToSession` refuses reserved
  names; `sendExtensionMessage` refuses any `msg.type === "plugin_emit_event"`
  (closes the raw-lane bypass). Both return `false` + one warn line.
- Bridge relay (`bridge.ts:1542`) unchanged.
- Coverage test: every `events.on("<ns>:…")` listener in
  `packages/extension/src` is under a reserved prefix or in a reviewed
  non-sensitive allowlist (`flow:`, …) — a new privileged listener outside the
  prefixes fails CI.
- Alternative rejected: static bridge allowlist — contradicts
  `automation-emit-configured-event`.

### D4 — `config.json` written `0600` everywhere (B25)

- `writeConfigFileSecure(file, text)` in `shared/src/config.ts`: write
  `${file}.tmp.${pid}.${randomUUID()}` with `{ mode: 0o600 }`, `chmodSync(tmp, 0o600)`
  in `try/catch` (umask-proof; ignored on `win32`), `renameSync`. All **eight** sites call it.
- `loadConfig`: a **separate** best-effort block before the parse `try` —
  skip on `win32`; `statSync`; if `mode & 0o077` → `chmodSync(file, 0o600)`;
  any error → one warn, never affects the returned config.
- Guard test: static scan of **non-test** source modules that reference
  `CONFIG_FILE` / `getConfigFile` / `config.json` fails on any raw
  `writeFileSync`/`renameSync` outside the helper; reviewed allowlist for
  unrelated writers (e.g. `auth/locked-json-file.ts`). Task 4.1 starts from a
  fresh grep, not the hand list.

### D5 — Exchange device bearer for an httpOnly cookie (B4)

- `POST /api/device-session` admitted by `Authorization: Bearer <device>`
  (`authVia === "device"`); route tier `observe` in `ROUTE_TIERS` so any device
  can exchange; both device-session routes get MCP `DENYLIST` entries. Sets `pi_dash_device` = bearer, httpOnly, `sameSite: "strict"`,
  `secure` as `pi_dash_token`, **`path: "/api/"`** (never rides `/ws*`, `/live`,
  `/auth`, `/mcp`), `maxAge` 400 days (`PairedDeviceRegistry` rows have no
  expiry). `DELETE /api/device-session` clears it.
- `bearer-auth.ts`: `Authorization` first; else, **only for `/api/*` URLs**,
  the `pi_dash_device` cookie. Same `authVia = "device"`, same tier; revocation
  kills both.
- **Same-origin only:** when `getApiBase()` is cross-origin (`VITE_API_URL`),
  no exchange — bearer behaviour unchanged (`cross-origin-client` spec).
- Client: `PairLanding.tsx` `finishPaired` (`:100-105`) **awaits** the
  exchange before `window.location.href = "/"` (on failure keeps the bearer), then stores non-secret marker `pi-dashboard:device-paired=1`;
  startup migration exchanges + removes a legacy `pi-dashboard:device-bearer`.
  `useWebSocket.ts:270` gates on `getApiBearer() != null || isDevicePaired()`
  (identity-plane ticketing preserved); `mintWsTicket` uses the bearer when
  present, else `credentials: "same-origin"` with no `Authorization`;
  `PairingApprovalHost.tsx:62` skips when `getDeviceBearer() || isDevicePaired()`. `/v1/*` from the browser loses the device
  bearer (no known browser `/v1` caller — verify in task).
- A `401` from the cookie-only ticket mint clears the paired marker (stale
  marker after revocation/expiry).
- Storage-disabled browsers keep the bearer in memory only for the session.
- Electron keyring bearer, WS ticket semantics unchanged.

### D6 — Pairing approval never honors bare loopback (owner decision)

Closes the pre-existing divergence between `qr-device-pairing` ("approval SHALL
NOT honor any loopback/tunnel exemption", spec `:88`) and `operatorGuard`
(`routes/pairing-routes.ts:110-113`, admits `isGenuinelyLocal`).

- New `approvalGuard` for `POST /api/pair/approve` (`:220`) and
  `POST /api/pair/approve-pending` (`:276`): admits login session
  (`authVia === "session"`), valid `pi_dash_local` cookie, or valid
  `X-Pi-Local-Token`; refuses `authVia === "device"` first; **no bare-loopback
  branch in any mode**; same enforce-mode Host admission as `operatorGuard`.
- `operatorGuard` (pending/deny/mint/revoke) keeps its D2 behavior.
- Client: the approval dialog maps a 401 to a hint ("open the dashboard with
  `pi-dashboard open`, or sign in").
- Default-mode change: an auth-off user who opened `http://localhost:8000` by
  hand must use `pi-dashboard open` (or Electron) to approve a pairing.

## Risks / Trade-offs

- **D2 `/v1/*` stays bare-loopback-trusted under strict** — a marker-less relay
  can spend model credentials via the proxy (no code exec). Accepted to avoid
  breaking local pi sessions; documented.
- **D2 local tooling** calling `control`/`operate` REST without the token (raw
  `curl -X POST /api/restart`) breaks under strict — documented; `npm run
  reload`/CLI paths must send the token (task verifies).
- **D3** — third-party `buildEvent` actions without `emits` are de-registered
  (warning names the missing field).
- **D5** — cookie carries the durable bearer; not JS-readable, revocable,
  `/api/`-scoped.

- **D1 multi-tab** — one state cookie; a second concurrent login overwrites
  it and the first tab's callback fails with "Invalid login state" (retry
  works). Accepted.
- **D3 residual** — a trusted plugin may still emit non-reserved names via
  `emitEventToSession` directly; current non-reserved listeners are benign;
  the listener-coverage test fails CI if a privileged one appears outside the
  prefixes.
- **D2 posture disclosure** — `canDiscloseAccessPosture` keeps bare
  `isGenuinelyLocal`, so under strict a relay still learns access posture
  (`/api/health` `accessGrants`/`trustPosture`); no admission. Accepted to keep
  `trusted-networks` disclosure semantics.
- **D6 default-mode change** — hand-typed localhost on auth-off installs can no
  longer approve pairings without the launcher. Deliberate (owner decision);
  surfaced in the dialog hint and docs.

## Migration / Compatibility / Rollback

- Migration: D4 chmod at load; D5 one-time localStorage→cookie exchange.
- Compatibility: default-mode admission unchanged except D6 (pairing
  approval); new routes additive;
  `requireLocalProof` absent = `false`.
- Rollback: revert. D4 leaves `0600` (harmless). D5 rollback leaves paired
  browsers without a bearer → re-pair (documented). D2 default off → invisible
  unless enabled.
