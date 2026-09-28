## Why

pi (the TUI, `/login`) offers OAuth sign-in for **8** LLM providers; the dashboard's Settings → Providers offers **3**. The gap is structural, not an oversight: `packages/server/src/auth/provider-auth-handlers.ts` is a hand-copied fork of pi-ai's flows — it imports only `node:crypto`, re-declares every `CLIENT_ID` / token URL / PKCE step, and so lags pi-ai by construction. Every pi-ai release that adds a provider (`meta` arrived in 0.86.1) reopens the gap.

Measured against pi-ai 0.86.1 (`dist/auth/oauth/`):

| provider | pi-ai flow | dashboard |
|---|---|---|
| `anthropic` | auth_code (PKCE + localhost:53692 callback) | ✓ |
| `openai-codex` | auth_code **or device_code** (`select` prompt) | ✓ browser only |
| `github-copilot` | device_code | ✓ |
| `kimi-coding` | device_code (RFC 8628, `auth.kimi.com`) | ✗ |
| `xai` | device_code (`auth.x.ai`) | ✗ |
| `meta` | device_code (`auth.meta.com` OIDC) | ✗ |
| `openrouter` | auth_code → **permanent API key** stored as `{type:"oauth", refresh:""}` | ✗ |
| `radius` | factory `createRadiusOAuth(options)` — needs gateway URL | ✗ (**out of scope**) |

The fork already lacks capabilities the original has, and one of them is a hard functional gap today:

- **No manual-code path.** Dashboard auth_code flows are `POST /api/provider-auth/authorize` → poll `GET /api/provider-auth/flow/:flowId`; there is no endpoint to *submit* a pasted code. `redirect_uri` is `http://localhost:<port>/…` and is **registered with the provider** — it cannot be pointed at a dashboard URL. So a dashboard running in docker / behind zrok **cannot complete Anthropic or Codex sign-in at all**. pi-ai's `anthropic.js:212-247` races the callback server against `prompt({type:"manual_code"})`, which accepts the full redirect URL (`parseAuthorizationInput` + state check) — the remote path exists, the dashboard just never calls it.
- **No Codex device-code.** pi-ai's `openai-codex` offers a `select` between browser and device-code login; the dashboard's copy hardwires browser.

pi-ai's `OAuthAuth.login(interaction)` was designed to be headless: the TUI is one `AuthInteraction` implementation. The interaction surface is a closed vocabulary — `notify({auth_url | device_code | progress | info})`, `prompt({manual_code | select | text | secret})`, `signal` — small enough that one adapter covers every current and future provider.

## What Changes

- **Delete** the three hand-ported handlers in `provider-auth-handlers.ts` and the bespoke PKCE / `postJson` helpers. **Replace** with one `AuthInteraction` adapter that drives `provider.auth.oauth.login()` for every built-in provider `ModelRuntime` (pi-coding-agent's public export) reports with an OAuth login, filtering out `radius`.
- **Generalise the flow record** on the server and the `phase: "waiting"` payload in the client from two hardwired shapes (`{authUrl}` | `{device}`) into a sticky `authUrl` plus a tagged `pending` union of pi-ai's prompt kinds: `device_code`, `manual_code`, `text`, `select`. (`secret` is issued by no bundled provider → rejected.)
- **Replace** `POST /authorize` + `POST /device-code` + `GET /device-status/:id` with `POST /api/provider-auth/start`, `GET /flow/:id`, `DELETE /flow/:id`; **add** `POST /api/provider-auth/flow/:flowId/input` — resolves the pending `prompt()` with the user's answer (pasted code / redirect URL, or a `select` option id).
- **Bump** `packages/server` dep `@earendil-works/pi-coding-agent` `^0.85.1` → `^0.86.1` so `meta` is in the provider set (six governed pins move together). The server imports only `@earendil-works/pi-coding-agent`, never pi-ai, so it cannot pick up the workspace-hoisted `@earendil-works/pi-ai` **0.75.5** (from the extension's `>=0.75.5` peer), which predates the OAuth provider definitions entirely.
- **Guard** `expires` rendering for `openrouter` (permanent key, `refresh:""`, no meaningful expiry).
- `GET /api/provider-auth/handlers` keeps its response shape; `name` now comes from the provider's OAuth login `name`.

Unchanged: `auth.json` write path (`provider-auth-storage.ts` lock + `writeCredential`), the bridge catalogue (`_buildProviderCatalogue` already discovers all 8 via `authStorage.getOAuthProviders()`), callback ports (53692 / 1455 — must match provider registration; the pre-existing `EADDRINUSE` hazard against a concurrent `/login` in a pi session is unchanged).

## Capabilities

- `provider-auth-server` — registry sourced from `ModelRuntime` providers; single `start` route; generic pending-prompt flow record with `flow/:flowId` status / input / cancel; lifetime + pruning; dependency floor.
- `oauth-callback-server` — removed (all five requirements describe the deleted dashboard callback server).
- `provider-auth-ui` — `manual_code` paste step and `select` step in the sign-in pane; `expires` guard.
- `provider-add-flow` — the pane's `flowType` branch becomes prompt-kind driven (no behaviour change for existing `auth_code` / `device_code` starts).

## Impact

- `packages/server/src/auth/provider-auth-handlers.ts` — rewritten (≈290 → registry from `ModelRuntime` + adapter).
- `packages/server/src/auth/oauth-callback-server.ts` — deleted; pi-ai owns the callback server. Importers: `provider-auth-routes.ts`, `server.ts` shutdown hook, two tests (see design D5).
- Six pi-version pins (`package.json` dep + `piCompatibility.minimum/recommended`, `pnpm-workspace.yaml` override, `docker/Dockerfile`, `verify-release-deps.mjs` minVersion).
- `packages/server/src/routes/provider-auth-routes.ts` — flow record union, new input route.
- `packages/server/package.json` — `pi-coding-agent` floor `^0.86.1`.
- `packages/shared/src/rest-api.ts:639-645` — `flowType` stays; add the pending-prompt union.
- `packages/client/src/components/settings/ProviderAuthSection.tsx` — `waiting` payload union, two new step renders, timers in `flowsTimersRef` unchanged.
- Tests: `provider-auth-storage.test.ts` untouched; handler tests replaced by adapter tests against a fake `OAuthAuth`.
- Version skew verified: pi-ai 0.85.1 and 0.86.1 write identical credential fields for every shared provider; only `meta` is added. `auth.json` shape is stable across the bump.

## Discipline Skills

- `security-hardening` — `POST flow/:flowId/input` carries a user-typed secret (auth code / redirect URL with `code=`). `flowId` is the capability; pi-ai enforces the OAuth `state` check inside `login()`; the input must not be logged.
- `doubt-driven-review` — deleting `oauth-callback-server.ts` and the three working handlers is the irreversible step; review the adapter against a live Anthropic login before the deletion stands.
- `review-code` — before commit.
