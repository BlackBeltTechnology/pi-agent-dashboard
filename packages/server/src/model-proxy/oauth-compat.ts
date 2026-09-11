/**
 * OAuth-incompatible model overrides for the dashboard model proxy.
 *
 * Some provider credentials are OAuth tokens (Claude Pro/Max, Codex) whose
 * upstream endpoint accepts only a subset of that provider's catalog — the
 * current Claude-Code / ChatGPT allowlist. Legacy dated snapshots are listed
 * by pi-ai but unreachable over OAuth, producing a confusing upstream 404.
 *
 * This table flags known OAuth-incompatible model ids per provider so the
 * registry excludes them from /v1/models when only an OAuth credential is
 * configured for that provider. Hand-maintained; review when a provider ships
 * a new model. Stale entries fall back to current behavior (listed-but-
 * unreachable), which is not a regression.
 *
 * See change: filter-oauth-incompatible-models, design §D2.
 */

/** Provider → set of model ids unreachable over OAuth credentials. */
export const OAUTH_INCOMPATIBLE: Record<string, ReadonlySet<string>> = {
  anthropic: new Set([
    // Legacy pre-4.x snapshots — unreachable over Claude Pro/Max OAuth.
    // The live registry catalog still ships `claude-3-5-haiku-latest`, so it
    // stays denied; the other pre-4.x `-latest` aliases are absent from the
    // 0.80.x catalog and were dropped. See change: filter-oauth-incompatible-models.
    "claude-3-5-haiku-20241022",
    "claude-3-5-haiku-latest",
    "claude-3-5-sonnet-20240620",
    "claude-3-5-sonnet-20241022",
    "claude-3-7-sonnet-20250219",
    "claude-3-opus-20240229",
    "claude-3-haiku-20240307",
    "claude-3-sonnet-20240229",
  ]),
  // openai: new Set([...]) // Codex-token-incompatible ids, populated when needed.
  // NOTE: the Codex OAuth credential is stored under the auth.json key
  // `openai-codex`, and the 0.85.1 catalog publishes the Codex-channel models
  // under `provider: "openai-codex"` — a first-class catalog entry, NOT a
  // remapped `openai` one (verified: `gpt-6-astra` ships once per channel, each
  // entry carrying its own provider). The registry filters on `model.provider`
  // EQUALITY, so the `openai-codex` credential routes the `openai-codex`
  // entries natively. No provider-key remap is needed, and one MUST NOT be
  // added: it would make a Codex subscription credential appear to route every
  // `openai`-provider model, widening credential scope to solve nothing.
  // See change: update-pi-core-0-85-adopt-apis.
};

/**
 * True when (provider, modelId) is a known OAuth-incompatible model.
 * Unknown provider or unknown id → false. Case-sensitive id match.
 */
export function isOauthIncompatible(provider: string, modelId: string): boolean {
  return OAUTH_INCOMPATIBLE[provider]?.has(modelId) ?? false;
}
