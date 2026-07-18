# provider-auth-storage.ts — index

Reads/writes `~/.pi/agent/auth.json` for pi provider credentials via `proper-lockfile` + atomic write. Exports `ApiKeyCredential`, `OAuthCredential`, `AuthCredential`, `AuthData`, `getAuthStatus`, `getOAuthProvidersMeta`, `resolveAuthJsonKey`. OAuth rows from `getAllHandlers()`; API-key rows from `provider-catalogue-cache.ts`. Custom providers skipped (managed by LLM Providers settings). See change: replace-hardcoded-provider-lists.
