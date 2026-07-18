# ProviderAuthSection.tsx — index

Settings section for LLM provider auth. Exports `ProviderAuthSection`. Fetches `/api/provider-auth/status` + `/handlers`. Splits OAuth vs API-key providers. `OAuthProviderRow`: auth-code flow (polls status 2s, 5min timeout) + device-code flow (`deviceModal`, polls `/device-status/<flowId>` 3s) + GitHub Enterprise domain prompt. `ApiKeyRow`: masked key, edit/save/remove. Uses `useAsyncAction` for deletes.
