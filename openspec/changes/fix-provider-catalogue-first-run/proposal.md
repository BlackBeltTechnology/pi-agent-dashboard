## Why

Issue: https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/907

On a fresh install, a user who only has an **API-key** provider (OpenCode Go, OpenRouter, DeepSeek, …) gets stuck. Onboarding requires a configured provider before it lets them continue. But Settings → Providers lists API-key providers only after a pi session has spawned, and onboarding blocks spawning a session. So the catalogue never fills in.

Reported root cause (verify during planning): in `packages/server/src/auth/provider-auth-storage.ts`, OAuth rows come from `getOAuthRegistry()` and are always present (~9). API-key rows come from the bridge-pushed catalogue (`packages/server/src/package/provider-catalogue-cache.ts`, `getLatestCatalogue()`), which stays empty until a session connects.

## What Changes

- When no bridge catalogue is cached, the server derives the API-key provider catalogue directly from the bundled/resolved `@earendil-works/pi-ai` (`getProviders()`, as the issue suggests; confirm this API exists in planning). The bridge-pushed catalogue stays authoritative once it is present.
- Optionally persist the last catalogue to disk so later cold starts show the full list immediately.
- Safety net: onboarding lets the user skip the provider step or spawn a session, with a hint that starting a session shows all providers.

## Capabilities

### Modified Capabilities
- `provider-auth-server` — API-key catalogue fallback when there is no bridge push.
- `landing-page-onboarding` — the provider step can no longer deadlock.
- (Confirm exact capability names in planning.)

## Non-goals

- Changing how OAuth providers are registered.
- Adding new providers.

## Discipline Skills

- `systematic-debugging` — confirm the deadlock on a clean profile before fixing it.
- `doubt-driven-review` — the server-side catalogue can drift from the bridge's pi version. Decide the precedence and when to refresh.
- `review-code` — before commit.
- No security trigger: catalogue metadata only, no credentials. Re-check if persisting to disk ever stores keys (it must not).

## Impact

- `packages/server/src/auth/provider-auth-storage.ts`, `packages/server/src/package/provider-catalogue-cache.ts`, onboarding/tutorial client components.
- Compatibility: additive. Rollback = revert. If the catalogue is persisted, it gets a new cache file under `~/.pi/dashboard/`; deleting the file is safe.
