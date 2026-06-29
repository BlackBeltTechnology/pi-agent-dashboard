## Why

Saving a custom LLM provider ("proxy") in dashboard Settings no longer works against current pi. The bridge registers the provider with a **bare synthetic env-var name** (`JUDO_<NAME>_KEY`) as its `apiKey`, stashing the real key in `process.env`. But pi's config-value resolution treats a plain string as a **literal** (pi #5661, #5095) — so the literal string `JUDO_<NAME>_KEY` is sent upstream instead of the real key. The synthetic-env indirection is a vestige of old pi semantics (bare name = env lookup); pi now resolves `registerProvider`'s `apiKey` natively, so the indirection is unnecessary and actively harmful (it also promotes the secret into `process.env`, where child processes and `/proc` can read it). Separately the dashboard reads `authStorage.getAuthStatus(id)` for the provider catalogue, which is blind to `registerProvider`-supplied keys (those live in `providerRequestConfigs`, surfaced only by the new `modelRegistry.getProviderAuthStatus(id)`), so a saved custom provider reports **"no API key setup."** Two save-path defects compound the confusion: a provider whose name is empty/whitespace is silently dropped, and a masked `***` key re-saved while the provider is absent from `providers.json` is persisted as the literal string `***`, corrupting the key.

## What Changes

- Bridge drops the synthetic-env hack: `resolveApiKeyEnvName` is replaced by `toRegisterApiKey` (`provider-register.ts`), which passes the providers.json `apiKey` straight to `registerProvider` — literal keys verbatim (with `$`→`$$` / leading `!`→`$!` escaping so pi's resolver cannot corrupt them), `$ENV` references unchanged. No `process.env` mutation, no `JUDO_*` variable.
- Provider-catalogue `configured`/`source` derivation (`_buildProviderCatalogue`) reads `modelRegistry.getProviderAuthStatus(id)` (registry-level, sees `registerProvider` keys) with `authStorage.getAuthStatus(id)` only as a fallback, so saved custom providers stop reporting "no API key setup."
- Settings save (`SettingsPanel` LLM-providers task) surfaces an error instead of silently dropping a provider with an empty/whitespace name.
- Server `PUT /api/providers` merge no longer writes the literal `***` sentinel as an apiKey when the named provider is absent from the existing file (reject or treat as missing key rather than corrupting).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `provider-auth-bridge`: custom-provider `apiKey` registration SHALL produce a key pi-ai 0.80.x resolves to the real secret; provider-catalogue `configured`/`source` SHALL derive from the registry-level provider auth status so `registerProvider`-supplied keys count as configured.
- `settings-panel`: saving LLM providers SHALL reject empty/whitespace provider names with a visible error instead of silently dropping them, and SHALL never persist the masked `***` sentinel as a real apiKey.

## Impact

- `packages/extension/src/provider-register.ts` — `toRegisterApiKey` (replaces `resolveApiKeyEnvName`), `registerEntry`, `_buildProviderCatalogue`.
- `packages/server/src/routes/provider-routes.ts` — `PUT /api/providers` merge (`***`-without-existing guard).
- `packages/client/src/components/SettingsPanel.tsx` — LLM-providers save task validation.
- Runtime contract with `@earendil-works/pi-coding-agent` / `pi-ai` (config-value literal-vs-`$ENV` semantics; `getProviderAuthStatus`).
- Out of scope: mid-session model-switch silent no-op in `bridge.setModel` (tracked separately).
- Out of scope: model-proxy / honcho resolves custom-provider keys from `auth.json` while the bridge resolves from `providers.json` — a separate reader divergence tracked for follow-up.
