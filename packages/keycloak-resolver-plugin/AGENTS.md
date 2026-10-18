# DOX — packages/keycloak-resolver-plugin

Files in this directory. One row per file. See change: add-multi-user-identity-plane.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. Bundled principal resolver for multi-user identity plane: validates Keycloak JWT access token as OAuth 2.0 resource server (RFC 9068, RS256 only, exact issuer, required audience, optional azp, expiry, subject; discovery + JWKS) → `(iss, sub)` principal. |
