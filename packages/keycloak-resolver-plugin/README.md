# Pi Dashboard Keycloak Resolver Plugin

Bundled dashboard **principal resolver** for the multi-user identity plane. It
validates a Keycloak JWT access token as an OAuth 2.0 resource server
([RFC 9068](https://www.rfc-editor.org/rfc/rfc9068)) and resolves it to an
`(iss, sub)` principal the dashboard uses for session ownership and access
control.

- **RFC 9068 validation** — RS256 only, exact issuer, required audience, optional
  authorized-party, expiry, and subject; discovery + JWKS with a cached,
  coalesced refresh.
- **Conditional DPoP** ([RFC 9449](https://www.rfc-editor.org/rfc/rfc9449)) —
  when an access token is sender-constrained (`cnf.jkt`), the matching DPoP proof
  is required and fully validated (proof signature, thumbprint, `htm`/`htu`,
  `ath`, freshness, single-use `jti`); an unbound token validates as a plain
  bearer.
- **Config-seeded** — the dashboard core imports nothing Keycloak-specific; all
  behavior comes from the operator's `identity` config. Unconfigured, the plugin
  registers but stays inert, so the dashboard behaves exactly as before.
- **Ownership disambiguation** — a token this resolver does not own (opaque, or a
  foreign issuer) resolves to `null` so other resolvers may claim it; an
  owned-but-invalid token is rejected, never silently passed through.

> **Bundled plugin.** This package ships inside the dashboard and is discovered at
> build time by a scan of `packages/*` — *not* from `node_modules`. Installing it
> standalone from npm does not activate it in an existing dashboard install. It is
> published so integrators can read the source and depend on its types.

## License

MIT — part of [pi-agent-dashboard](https://github.com/BlackBeltTechnology/pi-agent-dashboard).
