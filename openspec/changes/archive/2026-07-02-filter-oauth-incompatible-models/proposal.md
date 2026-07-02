## Why

Dashboard model proxy's `/v1/models` advertises every model pi-ai knows for any provider that has *some* credential, but only filters at provider granularity (`hasAuth(provider)`). When the linked credential is OAuth (Claude Pro/Max, Codex, etc.), the upstream endpoint accepts only a subset of that provider's models — typically the current Claude-Code / ChatGPT allowlist. Legacy snapshots like `claude-3-5-haiku-20241022` are listed yet unreachable: callers see the model in `/v1/models`, send a completion, and receive a confusing upstream `404 not_found_error` from Anthropic. This degrades trust in the proxy and breaks tools that auto-pick from `/v1/models`.

## What Changes

- Extend `InternalRegistry.getAvailable()` so filtering considers *credential kind × model id*, not only provider presence.
- Add a per-model `oauthCompatible?: boolean` flag (default `true`) in the registry's enriched model entry.
- Maintain a small overrides table (`packages/server/src/model-proxy/oauth-compat.ts`) that flags known OAuth-incompatible model ids (legacy Anthropic snapshots, Codex-restricted OpenAI ids, etc.). Built-in models inherit the flag at registration time.
- `getAvailable()`: for each model, if the provider's credential is `oauth` and `oauthCompatible === false`, exclude it. (auth.json holds one credential per provider key — `api_key` OR `oauth`, never both — so there is no "mixed creds" branch.)
- No change to `/v1/chat/completions` / `/v1/messages` runtime routing; only `/v1/models` listing and downstream `find()` lookup change.
- Diagnostics: `getAll()` keeps returning the unfiltered set; add a `getAllAnnotated()` sibling that attaches an `excludedReason` to entries dropped by the filter, exposed via a **new** `GET /api/model-proxy/diagnostics` route so the UI can later surface "hidden because requires API key".

## Capabilities

### New Capabilities
- `model-proxy-credential-routing`: rules for matching pi-ai models against the active credential set per provider, including OAuth-vs-api-key compatibility and the override table.

### Modified Capabilities
<!-- model-proxy spec lives in active change `add-dashboard-model-proxy` (not yet archived).
     This proposal layers on top via a new capability; the parent change is unaffected. -->

## Impact

- Code: `packages/server/src/model-proxy/internal-registry.ts` (filter logic), new `oauth-compat.ts` (override table + helper), new `internal-registry.test.ts`, `packages/server/src/routes/model-proxy-diagnostics-routes.ts` (new `GET /api/model-proxy/diagnostics` route).
- Behavior: `/v1/models` returns a smaller, accurate list when only OAuth is configured for a provider. Callers using legacy model ids will get `404` from `/v1/models` instead of a confusing upstream `404` mid-stream — clearer failure mode.
- No client/extension/protocol changes. No new config keys. No migration.
- Override table is hand-maintained; documented in `docs/architecture.md` model-proxy section. Drift risk is low (Anthropic OAuth allowlist changes ~quarterly) and bounded — falling back to current behavior (model listed but unreachable) is the cost of a stale entry, not a regression.
