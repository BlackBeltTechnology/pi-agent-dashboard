## Context

Dashboard custom providers ("proxies") are configured in `~/.pi/agent/providers.json` and registered into each pi session via `pi.registerProvider(name, config)` in `packages/extension/src/provider-register.ts::registerEntry`. The dashboard targets pi / pi-ai **0.80.2**.

pi-ai 0.80.x changed two things the dashboard's code predates:

1. **Config-value resolution (pi #5661, #5095).** A plain-string `apiKey` is now a **literal**; environment references require explicit `$ENV_VAR` / `${ENV_VAR}` syntax. Verified in `node_modules/@earendil-works/pi-coding-agent/dist/core/resolve-config-value.js`: `getConfigValueEnvVarNames("FOO")` returns `[]` for a bare name, so `resolveConfigValueOrThrow` yields the literal `"FOO"`.
2. **Provider auth status split.** `modelRegistry.getProviderAuthStatus(provider)` reports configured-ness including keys supplied via `registerProvider` (held in `providerRequestConfigs`); `authStorage.getAuthStatus(provider)` only knows `auth.json`. Verified in `dist/core/model-registry.js`.

Current dashboard behavior that breaks against this:

- `resolveApiKeyEnvName(name, apiKey)` stuffs the literal key into `process.env.JUDO_<NAME>_KEY` and returns the **bare** name (no `$`). Under current pi that bare name is a literal → upstream receives the string `JUDO_<NAME>_KEY`, never the real key. The synthetic-env indirection itself is obsolete: pi resolves `registerProvider`'s `apiKey` natively, so no env stash is needed.
- `_buildProviderCatalogue` derives `configured`/`source` from `authStorage.getAuthStatus(id)` → custom providers (key only in `providerRequestConfigs`) report `configured:false` → UI shows "no API key setup".
- `SettingsPanel` save filters `p.name.trim() !== ""` → blank-name rows silently dropped.
- `PUT /api/providers` merge writes literal `***` as apiKey when `entry.apiKey === "***"` but the provider is absent from the existing file.

## Goals / Non-Goals

**Goals:**
- A saved custom provider's real key reaches the upstream under pi-ai 0.80.x.
- A saved custom provider reports `configured: true` and stops showing "no API key setup".
- Blank-name provider rows fail save loudly instead of vanishing.
- The masked `***` sentinel is never persisted as a real key.

**Non-Goals:**
- Mid-session model-switch silent no-op in `bridge.setModel` (separate change).
- Reworking the model-discovery (`/v1/models`) probe or its api-type metadata enrichment.
- Migrating off the pi-ai `compat` entrypoint or to `createModels()`.

## Decisions

**D1 — apiKey resolution: drop the synthetic-env hack, pass the key directly.**
Replace `resolveApiKeyEnvName` with `toRegisterApiKey(apiKey)`, which hands the providers.json value straight to `registerProvider`: literal keys verbatim (escaping `$`→`$$` and a leading `!`→`$!` so pi's `resolveConfigValue` cannot misread them as an env reference or shell command), and `$ENV` input unchanged. No `process.env` mutation, no `JUDO_*` variable.
- *Why not keep the `$JUDO_*` env stash?* It is a vestige of old pi semantics (bare name = env lookup). pi now resolves `registerProvider.apiKey` natively (`authStorage.getApiKey() ?? resolveConfigValue(apiKey)`), so the indirection adds nothing and promotes the secret into `process.env` (readable by child processes / `/proc`) — a worse hygiene posture than holding it in `providerRequestConfigs`.
- *Why not move the key into `auth.json` (`{type:"api_key"}`, pi #5953)?* `validateProviderConfig` REQUIRES `apiKey` (or `oauth`) whenever a provider defines models (`model-registry.js`), and the dashboard always registers discovered models — so `auth.json`-only would force a *placeholder* apiKey into `registerProvider`, i.e. another hack. The `auth.json` path also re-enters the `custom:true` suppression contract. Rejected for scope; tracked as a follow-up for the separate proxy/`auth.json` reader divergence.

**D2 — catalogue `configured`/`source` from the registry-level status.**
`_buildProviderCatalogue` reads `modelRegistry.getProviderAuthStatus(id)` first, falling back to `authStorage.getAuthStatus(id)`/`authStorage.has(id)` when the method is absent (older pi). Spec field list updated to include the registry-level `source` values (`models_json_key`, `models_json_command`).
- *Why fallback?* Keeps the bridge resilient across pi versions; `getProviderAuthStatus` is 0.80.x-era.

**D3 — blank-name save guard is client-side.**
`SettingsPanel`'s LLM-providers save task validates names before building the PUT body; on a blank name it throws (the existing per-task `Promise.allSettled` failure path keeps the source dirty and surfaces the error). No server change needed for this defect.

**D4 — `***`-without-existing guard is server-side.**
`PUT /api/providers` merge rejects (400) or drops the key when `apiKey === "***"` and `existing[name]` is absent, so the sentinel can never become the stored key.

## Risks / Trade-offs

- [Restoring `$` breaks if a user literally wants a key starting with `$`] → user `$`-input is already treated as an env reference today; behavior for literal-`$` keys is unchanged (still ambiguous, pre-existing).
- [`getProviderAuthStatus` missing on a future/older pi] → fallback to `authStorage` preserves current behavior; no crash.
- [400 on `***`-without-existing could surface during a legit rename flow] → rename of existing providers is not supported in the UI (name field is read-only for saved providers), so the only path to `***`-without-existing is a prior corruption/out-of-band edit, which we want to block.

## Migration Plan

- Pure bug-fix; no data migration. Existing `providers.json` entries already corrupted to `apiKey: "***"` must be re-entered by the user (documented in the task validation message). Deploy via standard extension reload (`npm run reload`) + client rebuild.
- Rollback: revert the change; prior (broken-under-0.80.x) behavior returns.

## Open Questions

- None blocking. If product wants corrupted `***` keys auto-detected and surfaced in the UI, that is a follow-up.
