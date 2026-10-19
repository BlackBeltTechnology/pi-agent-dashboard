## Why

Issue: https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/907

On a fresh install, a user who only has an **API-key** provider (OpenCode Go, OpenRouter, DeepSeek, …) gets stuck. Onboarding requires a configured provider before it lets them continue. But Settings → Providers lists API-key providers only after a pi session has spawned, and onboarding blocks spawning a session. So the catalogue never fills in.

Root cause, checked against the code:
- `getAuthStatus()` in `packages/server/src/auth/provider-auth-storage.ts` builds two kinds of rows:
  - OAuth rows come from `getOAuthRegistry()`, which is built from the server's own `ModelRuntime`. They are available as soon as the runtime has loaded, with no session needed.
  - API-key rows come only from `getLatestCatalogue()` (`packages/server/src/package/provider-catalogue-cache.ts`). That catalogue stays empty until a bridge pushes `providers_list`.
- The Add-provider dialog lists exactly those `statuses`, so with no session it offers only OAuth providers.
- `LandingPage.tsx` locks Step ② while `!providersReady`. Step ③ needs a pinned folder. Even when a folder is pinned from the sidebar, the expanded first-pending step stays Step ①. So no Landing step offers a way to start a session.

## What Changes

- **Server fallback.** While no bridge catalogue is held, the server builds the API-key provider catalogue from its own `ModelRuntime`.
  - It uses the public `@earendil-works/pi-coding-agent` surface: `getProviders()` plus the async `checkAuth(id)`.
  - It does not use `getProviderAuthStatus(id)`: that reads an availability snapshot the server's runtime never fills (`refreshOnCreate: false`).
  - The server already serves `/api/models` and the OAuth registry from this runtime.
  - `provider-auth-server` forbids importing `@earendil-works/pi-ai` directly.
  - The bridge-pushed catalogue stays authoritative once a non-empty one arrives.
- **Catalogue notice.** `GET /api/provider-auth/catalogue-ready` gains an additive `fallback` flag.
  - Today, with no session, Settings → Providers shows an "unavailable" warning and no empty state.
  - In the fallback state it will show the normal empty state plus an informational notice: the Add picker offers pi's built-in providers, and providers added by extensions appear once a session runs.
- **Safety net: Skip for now.** Landing Step ① gets a secondary **Skip for now** action, remembered per browser.
  - Skipping unlocks Step ② and Step ③.
  - Step ① stays not-done. Its row collapses to "skipped" with a **Set up now** link back to the providers page.
- **Dropped:** writing the last catalogue to disk. The runtime fallback makes it redundant, and a persisted copy can go stale across pi upgrades.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `provider-auth-server`:
  - the API-key catalogue falls back to the server runtime when no non-empty bridge catalogue is held;
  - the catalogue-availability signal reports the fallback and waits for runtime readiness.
- `provider-auth-ui`: the catalogue notice tells fallback, available and unavailable apart.
- `landing-page-onboarding`: Step ① can be skipped, so onboarding can no longer deadlock.

## Non-goals

- Changing how OAuth providers are registered.
- Adding new providers.
- Matching the bridge's env-var hint (`envVar`) for unconfigured rows in the fallback. pi-coding-agent's public surface does not expose env-var names.
- Writing the catalogue to disk.

## Discipline Skills

- `systematic-debugging`: confirm the deadlock on a clean profile (no session, no `auth.json`) before fixing it.
- `doubt-driven-review`: the fallback can drift from the bridge catalogue (extension providers, env hints, a different pi copy). Precedence and invalidation are decided in design.md D2/D3.
- `security-hardening`: the change edits `packages/server/src/auth/`. Check that:
  - the fallback carries metadata and auth *status* only, never key material;
  - the auth check never refreshes OAuth tokens or writes credentials;
  - nothing is persisted.
- `performance-optimization`: every `/status` request now runs one async auth check per runtime provider (~42). Measure both endpoints before deciding whether to memoize (task 2.7).
- `review-code`: before commit.

## Impact

- Server:
  - `packages/server/src/model-proxy/server-model-runtime.ts`: structural `checkAuth` type.
  - `packages/server/src/package/provider-catalogue-cache.ts`
  - `packages/server/src/auth/provider-auth-storage.ts`
  - `packages/server/src/auth/provider-auth-registry.ts`
  - `packages/server/src/routes/provider-auth-routes.ts`
  - `packages/server/src/package/provider-probe.ts`: lazy config path.
  - new `packages/server/src/auth/runtime-provider-catalogue.ts`.
- Client: `packages/client/src/components/shell/LandingPage.tsx`, `packages/client/src/components/settings/ProviderAuthSection.tsx`, and i18n strings.
- Shared: the `CatalogueReadyResponse` type in `packages/shared/src/rest-api.ts`.
- Compatibility: additive.
  - `GET /api/provider-auth/status` keeps its bare-array shape.
  - `catalogue-ready` only gains a field; older clients ignore it.
- Migration and rollback: no migration. Rollback = revert. The only persisted state is one localStorage key for the skip.
