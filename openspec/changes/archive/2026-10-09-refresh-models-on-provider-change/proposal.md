## Why

Provider changes do not reach a session's model selector until the pi session restarts. Two holes:
- `request_models` (fired on every selector open) refreshes pi's registry but never re-diffs `providers.json`. Dashboard-registered providers only reload on the `credentials_updated` broadcast, which is fire-and-forget. A bridge that misses it (reconnecting, session not ready, hand/CLI edit, other dashboard instance, docker volume) stays stale forever.
- `credentials_updated` skips the refresh when the `providers.json` diff is empty. Credential-only changes (OAuth login, API key for a built-in provider in `auth.json`) therefore push a stale `models_list`.

A spike against the real `ModelRuntime` (173 available / 1622 models) measured `refresh({allowNetwork:false})` at ~6 ms and confirmed an empty-scoped refresh leaves a newly credentialed built-in provider unavailable while a full refresh shows it. Re-pulling on open is cheap.

## What Changes

- Selector-open `request_models` re-syncs dashboard-registered providers from `providers.json` before refreshing the registry.
- `credentials_updated` with no provider diff runs a local (no-network) full registry refresh instead of none.
- Selector-open refresh runs without remote catalogue fetches (`allowNetwork:false`), so a cold catalogue cache cannot stall the serialized bridge pump on every open.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `custom-provider-model-registry`: adds a requirement that provider and credential changes reach the session model list without restart, including when the change broadcast was missed.

## Impact

- `packages/extension/src/command-handler.ts` — `request_models` case.
- `packages/extension/src/bridge.ts` — `credentials_updated` handler.
- `packages/extension/src/provider-register.ts` — `reloadProviders` reused, no API change.
- No protocol, server, or client change.

## Discipline Skills

- `systematic-debugging` — root cause already established by spike; tests reproduce each hole before the fix.
- `review-code` — before commit.
- `performance-optimization` — refresh runs on every selector open on the serialized pump; keep it local-only and bounded by `REFRESH_TIMEOUT_MS`.
