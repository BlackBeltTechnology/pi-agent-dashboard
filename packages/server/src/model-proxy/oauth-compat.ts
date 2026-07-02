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
    "claude-3-5-haiku-20241022",
    "claude-3-5-haiku-latest",
    "claude-3-5-sonnet-20240620",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-sonnet-latest",
    "claude-3-7-sonnet-20250219",
    "claude-3-7-sonnet-latest",
    "claude-3-opus-20240229",
    "claude-3-opus-latest",
    "claude-3-haiku-20240307",
    "claude-3-sonnet-20240229",
  ]),
  // openai: new Set([...]) // Codex-token-incompatible ids, populated when needed.
  // NOTE: Codex OAuth is stored under auth.json key `openai-codex`, while pi-ai
  // models carry provider `openai`. The registry filter keys on `model.provider`,
  // so a raw `openai` slot will not see the `openai-codex` cred without a
  // provider-key remap.
};

/**
 * True when (provider, modelId) is a known OAuth-incompatible model.
 * Unknown provider or unknown id → false. Case-sensitive id match.
 */
export function isOauthIncompatible(provider: string, modelId: string): boolean {
  return OAUTH_INCOMPATIBLE[provider]?.has(modelId) ?? false;
}
