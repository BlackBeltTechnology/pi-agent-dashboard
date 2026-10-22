# DOX — packages/client-utils/src/identity

Browser identity-plane primitives (subpath `./identity/*`). One row per source file.

| File | Purpose |
|------|---------|
| `dpop.ts` | Conditional DPoP (RFC 9449): proof only once the IdP issued a `cnf.jkt`-bound token; non-extractable ES256 key. |
| `login-flow.ts` | Provider-agnostic OIDC login / callback / RP-initiated logout engine (`beginLogin`, `completeLogin`, `beginLogout`, `LoginFlowError`). Discovery endpoints (`authorization_endpoint`, `token_endpoint`, `end_session_endpoint`) must be `https:` or loopback `http:` (`isAllowedOidcEndpoint` over `classifyUrl`) before any navigation or token request; else `LoginFlowError("discovery-failed")`. See change: harden-client-sinks. |
| `oidc-flow.ts` | Pure OIDC authorization-code + PKCE helpers (`buildAuthorizeRequest`, `exchangeCode`, `OidcClientConfig`). |
| `pkce.ts` | PKCE S256 verifier / challenge primitives over WebCrypto (pure-JS SHA-256 fallback). |
| `token-store.ts` | In-memory access / id token store (never web storage); read by the shell's fetch wrapper. |
