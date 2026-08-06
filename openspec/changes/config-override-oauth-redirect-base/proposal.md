## Why

The dashboard derives every externally-visible URL from one runtime fact: the active tunnel URL (`getTunnelUrl()`), falling back to `http://localhost:<port>`. That is correct for the zrok/ngrok/tailscale flows the project ships, and wrong for the deployment shape a growing number of operators actually run: the dashboard behind a **reverse proxy on a stable custom domain** (`https://pi.example.com` → nginx/Traefik → `:8000`), with no dashboard-managed tunnel at all.

In that shape OAuth is simply broken. `buildRedirectUri()` emits `http://localhost:8000/auth/callback/github`, the provider rejects it (`redirect_uri_mismatch`), and the operator has no supported way to state the public origin. The only escape is to not use OAuth.

PR #409 (external contributor `Philogag`) fixes the OAuth half of this with a config-file field `auth.redirectBaseUrl` that takes precedence over the tunnel URL. This change captures that behaviour as spec, closes the gaps the PR leaves open (untested headline precedence, no validation, no diagnostic, no docs, no UI), and names the wider capability the field is the first slice of — because the same "what is my public origin?" question is answered by a *different* source of truth in pairing QR codes, `/api/tunnel/endpoints`, and the "Accessible at" surfaces, which this slice deliberately does not touch.

## What Changes

**Slice 1 — OAuth redirect base (PR #409, in scope here)**

- `AuthConfig` gains optional `redirectBaseUrl?: string`; `parseAuthConfig` trims it and omits blank / non-string values.
- `buildRedirectUri(provider, port, baseOverride?)` resolves its base by precedence: `baseOverride` → `getTunnelUrl()` → `http://localhost:<port>`; trailing slashes stripped from whichever base wins. Empty string behaves as absent (`||`, not `??`).
- `registerAuthPlugin` threads `authState.redirectBaseUrl` into all three call sites (`/auth/login` single-provider auto-redirect, `/auth/start/:provider`, `/auth/callback/:provider` token exchange) and reassigns it in `_reloadAuth`, so `PUT /api/config` applies without a restart.
- `writeConfigPartial` preserves `auth.redirectBaseUrl` across partial writes.

**Gap closure added by this change (not in PR #409)**

- The precedence the feature exists for — **override beats an active tunnel** — gets test coverage. PR #409's unit tests only exercise override-vs-localhost; the file's own comment concedes `getTunnelUrl()` returns null under test.
- Route-level coverage that the emitted `redirect_uri` query parameter (not just the helper's return value) carries the override, including after a hot reload.
- A startup/reload warning when `redirectBaseUrl` is set but not parseable as an absolute `http(s)` origin — the current failure mode is a silent provider-side `redirect_uri_mismatch` with nothing in the server log.
- `docs/architecture.md` config-reference entry + a `CHANGELOG.md [Unreleased]` line (PR #409 updates only the three `AGENTS.md` rows).

**Explicit non-goals (deferred, named so the spec is honest about the drift)**

- NON-GOAL: routing pairing QR codes, `/api/tunnel/endpoints`, or "Accessible at" through the override. They keep using the tunnel URL. A dashboard with `redirectBaseUrl` set therefore has *two* answers to "what is my public origin"; this change documents the split rather than papering over it.
- NON-GOAL: a Settings ▸ Security UI field. `writeConfigPartial` accepts the key but nothing in the client sends it — the field stays hand-edit-only in this slice.
- NON-GOAL: promoting the field to a top-level `publicBaseUrl`. That rename is the follow-up slice; `auth.redirectBaseUrl` ships first because it is the shipped PR and is trivially forward-compatible (a later `publicBaseUrl` becomes a lower-precedence default under it).

## Capabilities

### Modified Capabilities

- `oauth-authentication`: redirect-URI resolution grows a config-file override at the top of the precedence chain, threaded through every route that mints or echoes a `redirect_uri`, and reapplied on runtime auth reload.
- `shared-config`: `auth.redirectBaseUrl` added to the config schema with trim/blank/type normalization and partial-write preservation.

### New Capabilities

<!-- None. The wider public-base-URL capability is deliberately NOT created in this
     slice — creating it now would spec pairing/QR/endpoints behaviour nothing
     implements. It is named in design.md as the deferred follow-up. -->

## Impact

- **Code**: `packages/shared/src/config.ts` (type + parser), `packages/server/src/auth/auth.ts` (builder + validation warning), `packages/server/src/auth/auth-plugin.ts` (state + 3 call sites + reload), `packages/server/src/config-api.ts` (partial-merge preservation).
- **Tests**: `packages/shared/src/__tests__/config.test.ts` (parsing), `packages/server/src/__tests__/auth.test.ts` (builder, override-vs-localhost), new `packages/server/src/__tests__/auth-redirect-base.test.ts` (tunnel precedence via mocked `getTunnelUrl` + Fastify `inject()` route-level assertions), new `tests/e2e/oauth-redirect-base.spec.ts` (container-level config → restart → real 302 `Location`).
- **Docs**: `docs/architecture.md` auth/config reference, `CHANGELOG.md [Unreleased]`, three `AGENTS.md` rows (already in PR #409).
- **Config / operator surface**: new optional `auth.redirectBaseUrl` in `~/.pi/dashboard/config.json`. Absent = today's behaviour, byte-for-byte. Operator must also register the same URI with the OAuth provider.
- **Risk**: low blast radius — the value is operator-owned config, never request-derived, so there is no open-redirect vector; the provider's own `redirect_uri` allowlist is a second gate. The realistic failure is a typo producing a login loop, which is why the validation warning is in scope.
- **Known limitation surfaced by this work**: `registerAuthPlugin` returns early when the boot-time provider registry is empty, so `_reloadAuth` is never installed. Adding `redirectBaseUrl` (or any auth field) to a dashboard that booted with zero providers requires a restart, not just `PUT /api/config`. Documented, not fixed here.

## Discipline Skills

- `security-hardening` — the change touches the OAuth redirect surface; the review must confirm the override cannot be influenced by request data and that no unvalidated value reaches a `Location` header path that an attacker controls.
- `review-code` — external-contributor PR landing on `develop`; the diff needs the full design→correctness→tests pass before merge.
- `observability-instrumentation` — the misconfiguration failure mode is currently silent; the warning + doctor surface is an instrumentation task, not a feature task.
