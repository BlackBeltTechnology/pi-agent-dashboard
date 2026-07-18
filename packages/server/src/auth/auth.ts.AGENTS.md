# auth.ts — index

OAuth2 core: providers (GitHub, Google, Keycloak, generic OIDC via `.well-known` discovery), JWT sign/verify, allowlist, OAuth flow helpers. Exports `ResolvedProvider`, `AuthUser`, `TokenPayload`, `buildProviderRegistry`, `resolveProvider`, `fetchOIDCDiscovery`, `ensureAuthSecret`, `signToken`, `verifyToken`, `parseAuthCookie`, `isUserAllowed`, `buildRedirectUri`, `buildAuthorizeUrl`, `exchangeCode`, `fetchUserInfo`, `COOKIE_NAME`. Tunnels redirect URI via `getTunnelUrl`. Secret auto-generated + persisted to `CONFIG_FILE`.
