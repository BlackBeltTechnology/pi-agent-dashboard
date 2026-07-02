## Context

Dashboard model proxy (`packages/server/src/model-proxy/`) exposes pi-ai's full model catalog at `/v1/models`. `InternalRegistry.getAvailable()` filters by `hasAuth(provider, auth)` — a per-provider check that returns true if any credential (`api_key` or `oauth`) exists for that provider.

The blind spot: a single provider can have multiple credential kinds with **different model coverage**. Anthropic OAuth (Claude Pro/Max) accepts only the current Claude-Code allowlist (`claude-{sonnet,opus,haiku}-4-5/4-6` family); Anthropic API key accepts every dated snapshot. When only OAuth is configured, `/v1/models` still lists `claude-3-5-haiku-20241022`, `claude-3-5-sonnet-20241022`, etc., and a downstream completion hits an upstream `404 not_found_error`. Same shape exists for OpenAI Codex tokens vs API keys, and likely future providers.

Stakeholders: dashboard users (proxy callers), tool authors auto-picking from `/v1/models`, future provider integrations.

## Goals / Non-Goals

**Goals:**
- `/v1/models` lists only models reachable with the credentials currently in `~/.pi/agent/auth.json`.
- Distinguish between OAuth-routable and API-key-only models per provider.
- Keep the override list small, hand-maintained, and easy to update when Anthropic's OAuth allowlist drifts.
- `find()` lookup matches the same filter — so completion attempts with a non-listed id fail fast at the proxy with a clean `404`, not a confusing upstream error mid-stream.
- Diagnostics surface: `getAll()` keeps returning everything; excluded entries carry `excludedReason` so a future Settings UI can explain why a model is hidden.

**Non-Goals:**
- Probing upstream to discover the live allowlist (option C from earlier triage). Cost / token usage not justified.
- Per-user / per-key scope filtering (proxy API-key scopes are orthogonal — handled by `auth-gate.ts`).
- Changing routing behavior in `streamer.ts`. Models that pass the filter route exactly as today.
- Restructuring pi-ai's model metadata. We layer over it.

## Decisions

### D1. Filter granularity: credential-kind × model id

Replace `hasAuth(provider, auth)` with `canRouteModel(model, auth[provider])`:

```
canRouteModel(model, cred):
  if !cred: false
  if cred.type === "api_key" && cred.key: true            // api keys route everything
  if cred.type === "oauth" && (cred.access || cred.refresh):
    return model.oauthCompatible !== false                 // default true
  return false
```

Provider-level check survives as the outer loop (still skip providers with no credential at all).

**Alternative considered:** Static per-provider allowlist (option A). Rejected because the list lives further from the credential check and gets out of sync with `oauthCompatible` flags — two sources of truth.

### D2. `oauthCompatible` flag location

Add `oauthCompatible?: boolean` to the registry's enriched model entry (the `any`-typed object built in `getAllModels()`), defaulting to `true`. Source of truth for overrides: a new file `packages/server/src/model-proxy/oauth-compat.ts` exporting:

```ts
export const OAUTH_INCOMPATIBLE: Record<string /*provider*/, ReadonlySet<string /*modelId*/>> = {
  anthropic: new Set([
    "claude-3-5-haiku-20241022", "claude-3-5-haiku-latest",
    "claude-3-5-sonnet-20240620", "claude-3-5-sonnet-20241022", "claude-3-5-sonnet-latest",
    "claude-3-7-sonnet-20250219", "claude-3-7-sonnet-latest",
    "claude-3-opus-20240229", "claude-3-opus-latest",
    "claude-3-haiku-20240307",
    "claude-3-sonnet-20240229",
    // ...all snapshots that predate the Claude Code allowlist
  ]),
  // openai: new Set([...]) // Codex-token-incompatible ids, populated when needed
  // NOTE: Codex OAuth is stored under auth.json key `openai-codex`, while pi-ai
  // models carry provider `openai`. The filter keys on `model.provider`, so a raw
  // `openai` slot will not see the `openai-codex` cred without a provider-key remap.
};

export function isOauthIncompatible(provider: string, id: string): boolean { ... }
```

Built-in models loaded in `getAllModels()` get `oauthCompatible = !isOauthIncompatible(provider, id)`. Custom models default to `true` (user-added; if they need an override, they can set the flag explicitly in `models.json`).

**Alternative considered:** Patch pi-ai's bundled `models.generated.js` upstream. Rejected — pi-ai is a separate module, slower iteration loop, and the OAuth-allowlist concept is dashboard-proxy-specific.

### D3. Excluded-reason annotations

`getAvailable()` produces the filtered list. Add a sibling `getAllAnnotated()` that returns `{ model, excludedReason: null | "no-credential" | "oauth-incompatible" }`. Consumed by a **new** `GET /api/model-proxy/diagnostics` route created in this change (no such route exists today; `getAll()` currently has zero callers) and any future Settings UI. Keeps the public `getAll()` shape unchanged.

### D4. Drift policy

`OAUTH_INCOMPATIBLE` is hand-maintained. Risk of drift is bounded:
- **Stale entry (model is now OAuth-compatible upstream)** → user sees a model hidden, can add an Anthropic API key to unhide, or we delete the entry on next release.
- **Missing entry (newly added legacy id)** → falls back to today's behavior (listed-but-unreachable). Not a regression.

Document the override list in `docs/architecture.md` model-proxy section with a "review when Anthropic ships a new model" note.

## Risks / Trade-offs

- **[Risk] OAuth-incompat list drifts as Anthropic updates.** → Hand-maintained list with explicit doc note; bounded failure mode (fall back to current behavior).
- **[Risk] Misclassifying a model as OAuth-incompat hides a working model.** → Mitigated by user adding an API key to override, and by tests that pin the current Claude-Code allowlist (sonnet-4-5, opus-4-x, haiku-4-5) as `oauthCompatible: true`.
- **[Risk] Custom models don't know their OAuth status.** → Default `true`; users can opt out via `models.json` if they hit the same issue with a custom OAuth provider.
- **[Trade-off] Per-credential-kind filter increases registry complexity.** → Contained inside `internal-registry.ts`; no changes to streamer, auth-gate, or routes.
- **[Trade-off] We do not probe.** → Static list will lag reality by hours-to-weeks. Acceptable: failure mode is "user adds API key" or "we ship a patch". Probing would cost tokens on every refresh.

## Migration Plan

No data migration. No config schema change. No protocol change.

Rollout:
1. Land code change.
2. `getAvailable()` immediately filters legacy snapshots when only OAuth is configured.
3. Existing callers using current model ids are unaffected.
4. Callers using legacy ids over OAuth start getting `404` from `/v1/models` lookup (clearer than upstream 404). Document in CHANGELOG under "fixes".

Rollback: revert the commit; cache invalidation happens on next `refresh()`.

## Open Questions

- Should `models.json` (user-defined custom models) accept an `oauthCompatible` field, or is documenting the workaround (omit OAuth credential) sufficient? **Decision: accept the field; matches the registry shape and costs nothing.** Implemented in tasks.
- Do we want a CLI / API hook to query exclusion reasons (for the future Settings UI)? **Decision: yes, expose via a new `GET /api/model-proxy/diagnostics` route (created in this change) returning `excludedReason` per entry.** Implemented in tasks.
