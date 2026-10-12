## Why

pi's `~/.pi/agent/auth.json` holds one credential per provider id. A second subscription account for the same provider, such as two Anthropic accounts, cannot be used. LLM credentials also cannot reach sessions on other machines connected to the dashboard without being copied there. Copying an OAuth refresh token to several machines makes several refreshers, and providers that rotate refresh tokens on use (Anthropic, openai-codex) then revoke the token family.

This is part 2 of 3 and depends on `add-credential-vault`, which provides the vault, allowlist, trusted delivery and redaction.

## What Changes

- **OAuth accounts** in the vault. Two backends:
  - **Vault-stored.** The hub is the only refresher, under a per-account lock.
  - **Link.** Links the hub's existing `auth.json` login without copying or moving it. Refresh stays on today's server path; unlinking leaves `auth.json` untouched.
- **Enrolling an additional OAuth account** for a provider that already has one. The existing server-side sign-in flow writes to the vault; `auth.json` is untouched.
- **LLM bindings** map a provider id to an account:
  - `single` or `pool`;
  - OAuth delivery mode `lease` or `proxy`;
  - optional **clone provider id** (for example `anthropic-work`) with an explicit base provider, so a second account is usable alongside the first.
- **LLM delivery** through the bridge, using public pi extension APIs only. Nothing is written to files on the session machine.
  - **key** → provider override with the literal key.
  - **lease** (default; verified providers; own devices) → the hub issues a short-lived access token, delivered as the provider key and renewed before expiry. The refresh token never leaves the hub.
  - **proxy** → requests go through the hub's model proxy with a key owned by the device. No provider token leaves the hub, and revocation is immediate.
- **Pools** are proxy-only and opt-in. They fail over on rate limits only before the first response byte.
- **Local LLM credentials win.** Delivery does not override a local `auth.json` entry, a provider env var that pi uses, or a `providers.json` provider for the same id. Those bindings report `local-override`.
- **Model proxy.** It routes vault bindings only for requests carrying a device proxy key ("vault scope"). Vault-held accounts never land in `auth.json` and are not visible to other callers or to the plugin model runtime.
- **Redaction** extends to lease tokens and proxy keys.
- **Plugins** can read declared OAuth bindings as access tokens only.
- **Sibling re-scoping** (tasks):
  - `add-oauth-key-sync-service` (keysync) becomes the vault's standalone team deployment. It is proxy-only and keeps its envelope encryption.
  - `add-cloud-sync-connector` takes OAuth from the vault.

## Capabilities

### New Capabilities
- `vault-llm-credentials`: OAuth accounts (vault and link backends), the single refresher, enrolment, LLM bindings (modes, clones, pools), and plugin reads of OAuth bindings.
- `vault-llm-delivery`: LLM local precedence, literal key delivery, OAuth lease and proxy, proxy pool failover, vault scope, redaction of lease and proxy material, lease outage behaviour, and binding states.

### Modified Capabilities
- `model-proxy-credential-routing`: credential-kind filtering also counts the vault bindings of a device proxy key. Other callers are unchanged.

## Impact

- **Server.**
  - Vault OAuth store and refresher.
  - Composite credential store in the single model runtime (vault scope).
  - Lease issuance.
  - `ProxyApiKey.owner` and binding checks in `auth-gate`.
  - Failover before the first byte in the proxy.
  - Enrolment persist target.
- **Bridge.** Provider overrides tracked apart from `providers.json`, lease renewal, clone registration, and LLM precedence checks.
- **Client.** OAuth accounts, link, enrolment, LLM bindings, pools, and a lease revocation notice.
- **Security.**
  - After revocation, a lease token stays valid upstream until it expires. Lease is for the user's own devices; proxy gives immediate revocation.
  - Linked logins keep today's pi and server refresh pair.
- **pi version.** Seams were verified on pi 1.1.0, but the repo pins 1.0.0. Task T0 re-verifies them.
- **Compatibility and rollback.** Additive: with no LLM bindings, behaviour is identical. Disabling delivery unregisters every override.
- **Policy.** Pool failover across subscription accounts may conflict with provider terms, so it is opt-in and off by default.

## Discipline Skills

- `security-hardening`: OAuth tokens, device proxy keys, lease lifetime, vault scope.
- `performance-optimization`: lease issuance and proxy latency; failover on the request path.
- `doubt-driven-review`: before fixing the link semantics and the composite credential store.
- `observability-instrumentation`: lease, refresh, failover and revocation events.
- `systematic-debugging`: during the provider-applicability, identity and pi 1.0 spikes.
