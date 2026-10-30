# auth.ts — index

OAuth2 core: providers (GitHub, Google, Keycloak, generic OIDC via `.well-known` discovery), JWT sign/verify, allowlist, OAuth flow helpers. Exports `ResolvedProvider`, `AuthUser`, `TokenPayload`, `buildProviderRegistry`, `resolveProvider`, `fetchOIDCDiscovery`, `ensureAuthSecret`, `signToken`, `verifyToken`, `parseAuthCookie`, `isUserAllowed`, `buildRedirectUri`, `buildAuthorizeUrl`, `exchangeCode`, `fetchUserInfo`, `COOKIE_NAME`. `buildRedirectUri(provider, port, baseOverride?)` base precedence: `baseOverride` (config `auth.redirectBaseUrl`) → `getTunnelUrl()` → `http://localhost:<port>`; trailing slashes stripped. `resolveRedirectBase(port, baseOverride?)` returns `{ base, source }` where `source` ∈ `auth.redirectBaseUrl` | `tunnel` | `localhost` — the single resolution both `buildRedirectUri` and the session-cookie `Secure` flag derive from, so the minted URI and the cookie can never describe different origins. `warnOnInvalidRedirectBase(base)` warns (registration + every reload) when the base is not an absolute `http(s)` origin, carries a query/fragment, **or embeds userinfo** (`user:pass@` would leak into the authorize URL, provider logs and browser history; the warning never echoes the password); value still USED, never discarded — a typo must fail visibly, not silently no-op. See change: config-override-oauth-redirect-base (D4 amendment, D14). Secret auto-generated + persisted to `CONFIG_FILE`.

## add-passkey-user-auth

`AuthUser.tier?`; `signToken` adds `tier` when set; `verifyToken` rejects a present-but-invalid tier; `resolveGroupTier(groups, groupTiers)` (unconfigured ⇒ operate, highest match, none ⇒ null); `fetchUserInfo` returns OIDC `groups`. See change: add-passkey-user-auth.

`exchangeCode` now returns `{accessToken, idToken?} | null`; `idTokenGroups(idToken, clientId)` reads the back-channel id_token `groups` claim (aud must include the client id; claims only). Callback merges id_token ∪ userinfo groups before `resolveGroupTier`. See change: add-passkey-user-auth.

## harden-auth-credentials (B17)

`verifyToken` pins `algorithms:["HS256"]` (non-HS256/`none`/malformed header → null). `ensureAuthSecret` mints `randomBytes(32)` (64 hex); any existing non-empty secret (whitespace included) kept byte-identical; `length < 32` chars → one `console.warn` per process (module flag `shortSecretWarned`), never prints the secret. See change: harden-auth-credentials.

## close-security-map-high-findings (D3)

`PUBLIC_IDP_HOSTS` (accounts.google.com, github.com, gitlab.com, login.microsoftonline.com, appleid.apple.com). `classifyProviderConfig(key, cfg)` → `public`|`non-public` from CONFIG only (never discovery, H8): key `github`/`google`, or exact issuer-host match (URL-parsed, lowercased, one trailing dot stripped, port/scheme ignored); Microsoft only with first path segment `common|consumers|organizations`; unparseable `issuerUrl` ⇒ non-public (G13). `isOpenEnrolment(allowedUsers, groupTiers)` = same emptiness as `isUserAllowed`/`resolveGroupTier`. `openEnrolmentOf(providers, allowedUsers, groupTiers)` → `[{provider, mode: refused|open}]`. See change: close-security-map-high-findings.
