## Why

The dashboard derives every externally-visible URL from one runtime fact: the active tunnel URL (`getTunnelUrl()`), falling back to `http://localhost:<port>`. That is correct for the zrok/ngrok/tailscale flows the project ships, and wrong for the deployment shape a growing number of operators actually run: the dashboard behind a **reverse proxy on a stable custom domain** (`https://pi.example.com` → nginx/Traefik → `:8000`), with no dashboard-managed tunnel at all.

In that shape OAuth is simply broken. `buildRedirectUri()` emits `http://localhost:8000/auth/callback/github`, the provider rejects it (`redirect_uri_mismatch`), and the operator has no supported way to state the public origin. The only escape is to not use OAuth.

PR #409 (external contributor `Philogag`) fixes the OAuth half of this with a config-file field `auth.redirectBaseUrl` that takes precedence over the tunnel URL. This change captures that behaviour as spec, closes the gaps the PR leaves open (untested headline precedence, no validation, no diagnostic, no docs, no UI), **and then closes the drift it would otherwise ship**: the same "what is my public origin?" question is today answered by a *second* source of truth, `pairing.publicBaseUrls[]`, which feeds pairing QR codes, `/api/tunnel/endpoints`, and the "Accessible at" panel.

An earlier revision of this change deferred that reconciliation on the premise that the follow-up would introduce a *new* scalar `publicBaseUrl`. Grounding disproved the premise: `pairing.publicBaseUrls: string[]` already exists (`packages/shared/src/config.ts`), is already operator-editable through the Gateway UI, and already drives every non-OAuth public URL. Shipping a third key would have made the drift worse, not better. The unification is therefore folded into this change rather than deferred.

## What Changes

**Slice 1 — OAuth redirect base (PR #409, in scope here)**

- `AuthConfig` gains optional `redirectBaseUrl?: string`; `parseAuthConfig` trims it and omits blank / non-string values.
- `buildRedirectUri(provider, port, baseOverride?)` resolves its base by precedence: `baseOverride` → `getTunnelUrl()` → `http://localhost:<port>`; trailing slashes stripped from whichever base wins. Empty string behaves as absent (`||`, not `??`).
- `registerAuthPlugin` threads `authState.redirectBaseUrl` into all three call sites (`/auth/login` single-provider auto-redirect, `/auth/start/:provider`, `/auth/callback/:provider` token exchange) and reassigns it in `_reloadAuth`, so `PUT /api/config` applies without a restart.
- `writeConfigPartial` preserves `auth.redirectBaseUrl` across partial writes.

**Gap closure added by this change (not in PR #409) — LANDED on this branch**

> Status: the four bullets below are implemented in commits `7bef3c2d2`
> (validation warning), `057927176` (override-beats-tunnel tests), `204fea12b`
> (docs). They are kept here as the record of what ships, not as pending work —
> `tasks.md` §2–4 is the live checklist.


- The precedence the feature exists for — **override beats an active tunnel** — gets test coverage. PR #409's unit tests only exercise override-vs-localhost; the file's own comment concedes `getTunnelUrl()` returns null under test.
- Route-level coverage that the emitted `redirect_uri` query parameter (not just the helper's return value) carries the override, including after a hot reload.
- A startup/reload warning when `redirectBaseUrl` is set but not parseable as an absolute `http(s)` origin — the current failure mode is a silent provider-side `redirect_uri_mismatch` with nothing in the server log.
- `docs/architecture.md` config-reference entry + a `CHANGELOG.md [Unreleased]` line (PR #409 updates only the three `AGENTS.md` rows).

**Slice 2 — one public-origin source of truth (was deferred 6.1)**

- `pairing.publicBaseUrls: string[]` is promoted to top-level `publicBaseUrls: string[]`, read by **both** the pairing/endpoint surfaces and OAuth redirect resolution.
- `parseConfig` reads the legacy `pairing.publicBaseUrls` when top-level `publicBaseUrls` is absent, so existing config files keep working with no operator action. **Legacy-sourced values feed the pairing/endpoint surfaces only, never OAuth** — promotion to an OAuth source is opt-in, because the legacy key was populated to answer a different question and auto-adopting it could break a working login silently (D7).
- `buildRedirectUri` precedence becomes: `auth.redirectBaseUrl` → `publicBaseUrls` **when and only when it holds exactly one `https:` entry** → `getTunnelUrl()` → `http://localhost:<port>`. An ambiguous list (0 or ≥2 `https:` entries) falls through **and warns** rather than guessing (D7).
- `auth.redirectBaseUrl` survives as the OAuth-only override because the two keys differ in **arity**, not in meaning: `publicBaseUrls` is a list of every address the dashboard answers on, while an OAuth `redirect_uri` must be one pre-registered scalar. It is the operator's disambiguator for a multi-address deployment (D7).
- The pairing payload's publicly-trusted-TLS gate is unchanged: it stays authoritative at read time in `PairingManager.reachableUrls()`, so promoting the key cannot leak a non-TLS entry into a QR code (D8).

**Slice 3 — operator surfaces (was deferred 6.2 + 3.4)**

- Settings ▸ Security (`packages/client/src/components/settings/SettingsPanel.tsx`) gains a redirect-base input writing `auth.redirectBaseUrl` through the existing `PUT /api/config` path.
- **One "add gateway URL" action** (D12) states the public origin once and writes `publicBaseUrls`, `cors.allowedOrigins`, `auth.redirectBaseUrl` and `trustedNetworks` together, recording what it wrote so removal reverses exactly that. Shared component, used by both `GatewaySetupGuide` (first run) and a persistent Gateway-page control.
- A computed per-gateway **status** plus a **Fix** action (D13) reconciles drift, because the underlying keys stay independently editable.
- **Making the action actually apply** (D15): `cors.allowedOrigins` and `trustedNetworks` are read at request time instead of captured at boot, and `_reloadAuth` merges top-level `trustedNetworks` — fixing a pre-existing bug where any auth-carrying config write silently dropped top-level trusted networks until restart.
- The session cookie's `Secure` flag is derived from the resolved redirect base scheme (D14). **`trustProxy` is deliberately NOT enabled**: `request.ip` is what both authorization bypasses read (`auth-plugin.ts:288`, `localhost-guard.ts:116`), so trusting `X-Forwarded-For` would make them header-forgeable.
- The **resolved** redirect base — the value that actually won the precedence chain, plus which tier won it — is exposed on a gated runtime endpoint, read by a new `doctor` skill module over loopback, and mirrored to `server.log` at register/reload. The loopback + log paths exist because a remote operator with broken OAuth cannot obtain a JWT to reach the endpoint (D10).

**Slice 4 — provider deletion (was deferred 6.3)**

- `DELETE /api/config/auth/providers/:id` removes an OAuth provider, behind the same `networkGuard` + auth gate as `PUT /api/config`. The providers merge stays additive-only; deletion gets its own verb rather than overloading a merge sentinel.
- Deletion uses a new raw-config helper `deleteAuthProvider(id)`, **not** `writeConfigPartial` (whose spread-only merge cannot remove a key) and **not** the redaction path (which would clobber surviving providers' real secrets) — D9.
- Deleting the **last** provider is refused without an explicit `?force=true`: at runtime it produces auth *enforced with no login path*, not auth disabled, and can hard-lock a remote operator until restart (D9).

**Explicit non-goals**

- NON-GOAL: changing the publicly-trusted-TLS rule for pairing (D14). Promotion moves the key, not the gate.
- NON-GOAL: a UI for editing `publicBaseUrls` beyond what the Gateway page already provides.
- NON-GOAL: writing a default value for `auth.redirectBaseUrl` or `publicBaseUrls` in `ensureConfig()`.

## Capabilities

### Modified Capabilities

- `oauth-authentication`: redirect-URI resolution grows a config-file override at the top of the precedence chain (`publicBaseUrls` deliberately does **not** feed it — revised D7), threaded through every route that mints or echoes a `redirect_uri`, and reapplied on runtime auth reload. Provider deletion gains a dedicated route; the session cookie's `Secure` flag is derived from the resolved base.
- `shared-config`: `auth.redirectBaseUrl` added with trim/blank/type normalization and partial-write preservation; `pairing.publicBaseUrls` promoted to top-level `publicBaseUrls` with legacy-key fallback.
- `qr-device-pairing` / `tunnel-provider`: read the promoted top-level key; the TLS gate and payload semantics are unchanged.
- `settings-panel`: Security section gains the redirect-base input.
- `doctor-skill`: gains a module reporting the resolved redirect base and its winning source.

### New Capabilities

<!-- None. Slice 2 unifies an existing key rather than creating a new capability. -->

## Impact

- **Code**: `packages/shared/src/config.ts` (type + parser + `publicBaseUrls` promotion with legacy fallback), `packages/server/src/auth/auth.ts` (builder + validation warning + `publicBaseUrls` tier), `packages/server/src/auth/auth-plugin.ts` (state + 3 call sites + reload), `packages/server/src/config-api.ts` (partial-merge preservation), `packages/server/src/tunnel/tunnel-endpoints.ts` + `packages/server/src/routes/system-routes.ts` + `packages/server/src/server.ts` (read the promoted key), `packages/client/src/components/settings/SettingsPanel.tsx` (Security input), `packages/client/src/components/Gateway/*` + `packages/client/src/lib/gateway/*` (promoted key), new `DELETE /api/config/auth/providers/:id` route, new `doctor` module.
- **Tests**: `packages/shared/src/__tests__/config.test.ts` (parsing), `packages/server/src/__tests__/auth.test.ts` (builder, override-vs-localhost), new `packages/server/src/__tests__/auth-redirect-base.test.ts` (tunnel precedence via mocked `getTunnelUrl` + Fastify `inject()` route-level assertions), new `tests/e2e/oauth-redirect-base.spec.ts` (container-level config → restart → real 302 `Location`).
- **Docs**: `docs/architecture.md` auth/config reference, `CHANGELOG.md [Unreleased]`, three `AGENTS.md` rows (already in PR #409).
- **Config / operator surface**: new optional `auth.redirectBaseUrl` in `~/.pi/dashboard/config.json`. Absent = today's behaviour, byte-for-byte. Operator must also register the same URI with the OAuth provider.
- **Risk**: Slice 1 has a low blast radius — the value is operator-owned config, never request-derived, so there is no open-redirect vector; the provider's own `redirect_uri` allowlist is a second gate. **Slice 2 raises the risk materially**: it touches the pairing payload path, whose TLS gate is a security boundary. The mitigation is that the gate is read-time and untouched (D8), pinned by a regression test. **Slice 3 now touches two authorization gates** (D15 makes CORS + `networkGuard` read live config) and the session-cookie flag (D14) — this is the highest-risk part of the change and the reason `trustProxy` was rejected. **Slice 4** adds a destructive route and therefore needs the same auth gate as `PUT /api/config`.
- **Known limitation surfaced by this work**: `registerAuthPlugin` returns early when the boot-time provider registry is empty, so `_reloadAuth` is never installed. Adding `redirectBaseUrl` (or any auth field) to a dashboard that booted with zero providers requires a restart, not just `PUT /api/config`. Documented, not fixed here.

## Discipline Skills

- `security-hardening` — the change touches the OAuth redirect surface; the review must confirm the override cannot be influenced by request data and that no unvalidated value reaches a `Location` header path that an attacker controls.
- `review-code` — external-contributor PR landing on `develop`; the diff needs the full design→correctness→tests pass before merge.
- `observability-instrumentation` — the misconfiguration failure mode is currently silent; the warning + doctor surface is an instrumentation task, not a feature task.
