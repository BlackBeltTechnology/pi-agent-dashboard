## Why

pi's `~/.pi/agent/auth.json` holds one credential per provider id. A second subscription account for the same provider, such as two Anthropic accounts, cannot be used. LLM credentials also cannot reach sessions on other machines connected to the dashboard without being copied there. Copying an OAuth refresh token to several machines makes several refreshers, and providers that rotate refresh tokens on use (Anthropic, openai-codex) then revoke the token family.

This is part 2 of 3 and depends on `add-credential-vault`, which provides the vault store, bindings with per-project grants and checkout confirmation, trusted delivery with reconciliation and offline grace, and redaction.

## What Changes

- **OAuth accounts** in the vault. Two backends:
  - **Vault-stored.** The hub is the only refresher: one per-account access-token path serves leases, proxied requests and plugin reads.
  - **Link.** Links the hub's existing `auth.json` login without copying or moving it. It stays with today's coordinated refresh (hub-local pi plus the server), adding no refresher; unlinking leaves `auth.json` untouched. Enrolling the same upstream account into the vault is refused where the provider exposes an identity.
- **Enrolling an additional OAuth account** for a provider that already has one. The existing server-side sign-in flow writes to the vault; `auth.json` is untouched.
- **LLM bindings** (target `llm`, named by provider id) are granted per project exactly like env bindings:
  - `single` (with per-project account overrides) or `pool`;
  - delivery `key`, `lease` or `proxy`;
  - optional **clone provider id** (for example `anthropic-work`) with an explicit base provider, so a second account is usable alongside the first.
- **LLM delivery** through the bridge, using public pi extension APIs only. Delivered material is never written to pi configuration files on the session machine.
  - **key** → provider override with the literal key.
  - **lease** (default; verified providers; own devices) → the hub issues a short-lived access token, delivered as the provider key and renewed before expiry. The refresh token never leaves the hub.
  - **proxy** → requests go through the hub's model proxy with a per-session key confined to its binding. No provider token leaves the hub, and revocation is immediate. Proxy is available for providers on `anthropic-messages` or `openai-completions`, the APIs the proxy serves, and, for OAuth accounts, only for lease-verified providers (the hub passes the access token the same way). Spikes T6 (wire) and T7 (request scope) gate it; if they fail, proxy and pools do not ship and `key`/`lease` delivery is unaffected.
- **Pools** are proxy-only and opt-in. They fail over on rate limits only before the first response byte.
- **Local LLM credentials win.** Delivery does not override a local `auth.json` entry, a provider env var that pi uses, a `providers.json` provider, or a `models.json` provider key for the same id. Those bindings report `local-override`.
- **Model proxy.** It routes vault bindings only for requests carrying an owned session key ("vault scope"); such a request resolves bare model ids within its binding and cannot address other providers. Vault-held accounts never land in `auth.json` and are not visible to other callers or to the plugin model runtime.
- **Redaction** extends to LLM keys, lease tokens and proxy keys, with marker `[REDACTED:<binding name>]`.
- **Plugins** can read declared `llm` bindings; OAuth bindings return access tokens only.
- **Sibling re-scoping** (tasks):
  - `add-oauth-key-sync-service` (keysync) becomes the vault's standalone team deployment. It is proxy-only and keeps its envelope encryption.
  - `add-cloud-sync-connector` takes OAuth from the vault.

## Capabilities

### New Capabilities
- `vault-llm-credentials`: OAuth accounts (vault and link backends), the single refresher, enrolment, LLM bindings (modes, clones, pools), and plugin reads of OAuth bindings.
- `vault-llm-delivery`: LLM local precedence, literal key delivery, OAuth lease and proxy, proxy pool failover, vault scope, redaction of lease and proxy material, lease outage behaviour, and binding states.

### Modified Capabilities
- `model-proxy-credential-routing`: credential-kind filtering counts the vault binding of an owned session key; credential writes and the single-refresh rule are per vault account for vault-held credentials. Other callers are unchanged.
- `credential-vault` (from `add-credential-vault`; archive after it): `llm` bindings may deliver `oauth` accounts, while env bindings stay `key`-only.
- `model-proxy`: "Model availability mirrors…" and "Model ID resolution" gain an owned-key branch (binding-only listing; bare ids resolve within the binding; no fallback). Other callers are unchanged.

## Impact

- **Server.**
  - Vault OAuth store and refresher.
  - Vault scope across the single model runtime: composite credential store, `InternalAuthStorage` presence and per-credential single-flight, `InternalRegistry` owned-key listing (task T7 verifies the async-context scope).
  - Lease issuance.
  - `ProxyApiKey.owner`, session-key minting and lifecycle revocation, binding confinement in `auth-gate` and model resolution.
  - Failover before the first byte in the proxy.
  - Enrolment persist target.
- **Bridge.** Provider overrides tracked apart from `providers.json` in the foundation's `process` registry, lease renewal, re-registration after reload, clone registration, and LLM precedence checks.
- **Client.** OAuth accounts, link, enrolment, LLM bindings, pools, and a lease revocation notice.
- **Security.**
  - After revocation, a lease token stays valid upstream until it expires. Lease is for the user's own devices; proxy gives immediate revocation.
  - Linked logins keep today's pi and server refresh pair.
- **pi version.** Several seams were observed on pi 1.1.0, but the repo pins 1.0.0. Task T0 re-verifies them; T6 verifies the proxy wire.
- **Compatibility and rollback.** Additive: with no LLM bindings, and for unowned proxy keys, behaviour is identical. Disabling delivery unregisters every override and revokes every session key.
- **Policy.** Pool failover across subscription accounts may conflict with provider terms, so it is opt-in and off by default.
- **Known limitation.** A hub whose LLM accounts are all vault-backed shows "no providers" in onboarding until `credential-detection` counts the vault (follow-up).

## Discipline Skills

- `security-hardening`: OAuth tokens, device proxy keys, lease lifetime, vault scope.
- `performance-optimization`: lease issuance and proxy latency; failover on the request path.
- `doubt-driven-review`: before fixing the link semantics and the composite credential store.
- `observability-instrumentation`: lease, refresh, failover and revocation events.
- `systematic-debugging`: during the provider-applicability, identity and pi 1.0 spikes.
