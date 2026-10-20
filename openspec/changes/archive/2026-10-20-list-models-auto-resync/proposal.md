# Proposal

## Why

`list_models` claims to return the set the human Model Selector shows, but only the Selector path (`request_models`) heals the registry first: it re-diffs `~/.pi/agent/providers.json` and runs a local `registry.refresh()`, which re-reads `models.json` and `auth.json`. `list_models` reads `cachedModelRegistry.getAvailable()` as-is. Suppose a provider was added or credentialed in another session, in Settings, or by hand-editing the global config, and this session missed the `credentials_updated` broadcast. The human then sees the model and the agent does not, so agents pick wrong refs in `update_roles`.

While investigating, we found a latent hazard that frequent resyncs would amplify. When `providers.json` exists but is unparseable (for example during a non-atomic hand-edit save), the re-sync treats it as `{}` and **unregisters every custom provider** in the session.

## What Changes

- `list_models` automatically resyncs the in-process registry from global config on **every** call, before reading. No new parameter. Steps:
  1. `reloadProviders(pi)`: re-diff `providers.json` (no-op when unchanged; serialized via `reloadChain`). Has its own short bound.
  2. `registry.refresh({ allowNetwork: false })`: re-read `models.json` and stored credentials and recompute availability. Local only. It always runs, even if step 1 failed or timed out, and has its own bound.
- Failure, abort or timeout **degrades** to the last-known catalogue and never throws. An agent abort stops waiting but never aborts a refresh pass that other callers may share.
- Additive result field `refreshErrors?: { provider, message }[]`, omitted on success or abort, mirroring the Selector's `models_list.refreshErrors`.
- Absent registry is unchanged: `registryReady: false` is returned immediately, with no resync.
- **Fix (BREAKING-ish, intentional):** an unreadable or unparseable `providers.json`, or one whose `providers` key is missing or not an object, no longer unregisters custom providers. The re-sync keeps the current registrations and logs the failure. An absent file, or an explicit `"providers": {}`, still removes them. This intentionally changes `request_models` and `credentials_updated` for that error case, because they share the re-sync.
- `list_models` spec wording: "READ-ONLY" becomes "never writes config files". The tool now re-syncs in-process registrations, which can push `models_list`/`providers_list` to the dashboard as a side effect.
- `request_models` code is untouched. The `list_models` resync is a separate small helper. Its behavior changes only through the shared unreadable-file fix above.
- Out of scope:
  - Forcing a network re-fetch of remote `/models` catalogues.
  - Applying `settings.json` `enabledModels` to `list_models`. Today `list_models` intentionally omits that filter and the Selector applies it, and that difference is kept.
  - `list_roles`, which already reads `providers.json` fresh.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `agent-role-model-tools`:
  - MODIFIED `list_models` requirement: "READ-ONLY" is replaced by "never writes config".
  - ADDED: resync-before-read.
  - ADDED: degraded failure semantics with bounded timeout and `refreshErrors`.
- `provider-auth-bridge`: MODIFIED "Bridge hot-reloads providers.json". Its "read fails" scenario now keeps registrations. New scenarios cover a missing or non-object `providers` key, an explicit `{}`, a missing file, and recovery.

## Impact

- `packages/extension/src/model-refresh.ts`: new `resyncForListModels` helper (bounded, signal-aware, never throws) and `toRefreshErrors`.
- `packages/extension/src/role-model-tools.ts`: `list_models` `execute` awaits the resync. Adds an optional `reloadProviders` dep, an optional `refreshErrors?` on `ModelsResult`, and a qualified tool description.
- `packages/extension/src/bridge-handlers/lifecycle.ts`: wires `reloadProviders: () => reloadProviders(pi)`.
- `packages/extension/src/provider-register.ts`: `loadProviders` distinguishes absent, parsed and unreadable. `reloadProvidersNow` skips removals and changes when unreadable.
- `packages/extension/src/command-handler.ts`: untouched.
- Server-side `registry-singleton.ts` `readProviders` keeps its own `{}`-on-parse-error behavior, so `/api/models` and the model proxy can briefly diverge from the session during a bad save. This is out of scope and recorded as a risk.
- The `mcp-server-plugin` `list_models` (REST `GET /api/models`) is a separate tool and is unaffected.
- Latency: one local refresh (milliseconds) per call. A network `/models` discovery runs only when `providers.json` actually changed, capped by the resync timeout. Rebuild: extension only, then `npm run reload`.

## Discipline Skills

- `review-code`: shared re-sync path plus a destructive-path fix. Run before commit.
- `doubt-driven-review`: already applied to these artifacts during planning.
- No `security-hardening` or `observability-instrumentation` trigger: no new untrusted input or endpoint, and failures reuse the existing `reportRefresh` logging. `performance-optimization` is not triggered because there is no latency budget. The new resync timeout is a bound, not a tuned target.
