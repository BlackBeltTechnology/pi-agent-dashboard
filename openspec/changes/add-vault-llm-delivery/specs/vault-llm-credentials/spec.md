## Purpose

Extend the credential vault with LLM credentials. It covers OAuth accounts held by the hub or linked to its existing login, a single refresher per account, and enrolment of additional accounts. It also covers LLM bindings (single, pool, clone provider ids), so more than one account per provider can be used.

## ADDED Requirements

### Requirement: OAuth accounts
The vault SHALL accept accounts of kind `oauth` in addition to `key`. Each account has a backend:
- `vault`: the tokens are stored in the vault file;
- `link`: the account refers to the hub's `~/.pi/agent/auth.json` entry for a provider.

The vault SHALL allow more than one `oauth` account for the same provider.

#### Scenario: Two Anthropic accounts coexist
- **WHEN** the user has linked the hub's `anthropic` login as "personal" and enrolled a vault-backed `anthropic` account "work"
- **THEN** the vault lists both accounts for `anthropic`, with their backends

### Requirement: Linking the existing login without a second refresher
The vault SHALL let the user link the hub's existing `auth.json` credential for a provider as an account.
- **No copy.** Linking SHALL NOT copy, move or modify the `auth.json` entry, and the vault SHALL never write `auth.json`.
- **Refresh.** A linked OAuth account SHALL be refreshed only through the path the dashboard server already uses for that entry.
- **Reuse.** The stored access token SHALL be reused while it has at least the minimum lease lifetime remaining.
- **Unlink.** Revoking a linked account SHALL unlink it and leave `auth.json` unchanged.
- **Rotate.** Rotating a linked account SHALL be done by signing in again through the existing provider flow.

#### Scenario: Linking leaves auth.json untouched
- **WHEN** the user links the hub's `anthropic` login as account "personal"
- **THEN** `auth.json` is byte-identical to before, and account "personal" is listed with a link backend

#### Scenario: Valid stored token is reused without refresh
- **WHEN** a lease is requested from a linked account whose stored access token is valid for longer than the minimum lease lifetime
- **THEN** no upstream refresh is performed, and the stored access token is issued

#### Scenario: Linked refresh keeps the refresh token out of the vault
- **WHEN** a lease is requested from a linked account whose access token has expired
- **THEN** the token is refreshed through the server's existing `auth.json` credential path
- **AND** the vault file holds no copy of the refresh token

#### Scenario: Unlinking leaves auth.json untouched
- **WHEN** the user revokes linked account "personal"
- **THEN** the account is removed from every binding
- **AND** `auth.json` is byte-identical to before

### Requirement: Single refresher per vault-backed OAuth account
For OAuth accounts stored in the vault, the hub SHALL be the only party that uses the refresh token. The hub SHALL:
- serialise refreshes per account, with concurrent requests sharing one upstream refresh;
- hold no file lock while the network refresh is in flight;
- propagate an abort signal to the refresh;
- persist the rotated refresh token before handing out any access token obtained from it.

Refreshing one account SHALL NOT block refreshing a different account of the same provider. If the account was revoked during the refresh, the minted token SHALL be discarded and no lease issued from it. A vault-backed account SHALL never be written to `auth.json`.

#### Scenario: Concurrent lease requests trigger one refresh
- **WHEN** two sessions request a lease for the same expired vault-backed account at the same time
- **THEN** exactly one upstream refresh is performed, and both sessions receive an access token from it

#### Scenario: Accounts of one provider refresh independently
- **WHEN** account "personal" is mid-refresh and a lease is requested for account "work" of the same provider
- **THEN** the "work" lease is served without waiting for the "personal" refresh

#### Scenario: Revoked during refresh
- **WHEN** an account is revoked while its refresh is in flight
- **THEN** the minted token is discarded, and no lease is issued from it

#### Scenario: Vault-backed account is never written to auth.json
- **WHEN** a proxied request causes the hub to refresh vault-backed account "work"
- **THEN** `auth.json` is unchanged and the rotated tokens are stored only in the vault

### Requirement: Token material never leaves the hub through management surfaces
No OAuth access token or refresh token SHALL appear in management API responses, the Settings UI, CLI output, logs or error messages. Status SHALL expose only non-secret fields, such as expiry, last refresh outcome and `needs-reauth`.

#### Scenario: Refresh failure is reported without material
- **WHEN** an OAuth refresh for an account fails
- **THEN** the log entry and any returned error name the account id and the failure kind, and contain no token material

### Requirement: LLM bindings
The vault SHALL support bindings with target `llm`, whose id is a pi provider id.
- **Mode.** An `llm` binding SHALL be `single` (exactly one account) or `pool` (an ordered list of accounts with a primary).
- **OAuth delivery.** An `llm` binding to an `oauth` account SHALL declare a delivery mode: `lease` or `proxy`.
- **Lease support.** `lease` SHALL be accepted only for providers on the lease-supported list.
- **Clones.** An `llm` binding MAY declare a clone provider id with an explicit base provider. The clone inherits the base's API and model list.
- **Sharing.** A `key` account MAY back both `env` and `llm` bindings.

#### Scenario: One account backs an env and an LLM binding
- **WHEN** the user binds a Gemini `key` account to env binding `GEMINI_API_KEY` and to LLM binding `google`
- **THEN** both bindings are listed and reference the same account

#### Scenario: Clone provider bound to a second account
- **WHEN** the user creates LLM binding `anthropic-work` as a clone of `anthropic`, bound to account "work"
- **THEN** the binding is listed with base provider `anthropic` and account "work"
- **AND** binding `anthropic` remains bound to its own account

#### Scenario: Binding rejects an account of the wrong provider
- **WHEN** the user binds LLM provider id `openai-codex` to an `anthropic` account
- **THEN** the request is rejected with a validation error, and no binding changes

#### Scenario: Lease limited to supported providers
- **WHEN** the user creates a `lease` binding for a provider that is not on the lease-supported list
- **THEN** the request is rejected, and the user is offered `proxy` delivery instead

### Requirement: Pools are proxy-only and opt-in
A `pool` binding SHALL require `proxy` delivery. Pool failover SHALL be disabled by default. Enabling it SHALL require an explicit user action that acknowledges the provider-terms notice. A pool with failover disabled SHALL behave as `single` on its primary account.

#### Scenario: Pool with lease delivery is rejected
- **WHEN** the user creates a pool binding with delivery mode `lease`
- **THEN** the request is rejected with a validation error

#### Scenario: New pool defaults to failover disabled
- **WHEN** the user creates a proxy pool binding with two accounts
- **THEN** the pool is stored with failover disabled
- **AND** only the primary account is used until the user enables failover

### Requirement: Additional OAuth account enrolment
The user SHALL be able to enrol an OAuth account for a provider that already has one. Enrolment SHALL run that provider's sign-in flow with the vault as destination and a user-supplied label, and SHALL NOT modify `~/.pi/agent/auth.json`.
- **Identity match.** When the provider exposes an account identity that matches an existing account, the vault SHALL update that account's tokens instead of creating a duplicate.
- **No identity.** When no identity is available, the vault SHALL ask the user whether the enrolment is a new account or replaces a named one.

#### Scenario: Second Anthropic account enrolled
- **WHEN** the user runs "Add account" for `anthropic` with label "work" while account "personal" exists
- **THEN** a new account "work" is stored
- **AND** account "personal" and `auth.json` are unchanged

#### Scenario: Re-enrolling the same identity
- **WHEN** the user enrols an `anthropic` account whose provider identity equals that of account "work"
- **THEN** account "work" receives the new tokens, and no second account is created

### Requirement: Plugin reads of OAuth bindings
A declared and approved `oauth` binding (see `credential-vault`, plugin read access) SHALL return a current access token to the plugin and never a refresh token. Vault-backed accounts SHALL NOT be reachable through the provider-auth read or through the plugin model runtime. A linked account remains readable through the existing provider-auth read, because it is an `auth.json` record.

#### Scenario: OAuth binding returns no refresh token
- **WHEN** an approved plugin reads a declared `oauth` binding
- **THEN** it receives an access token and no refresh token

#### Scenario: Vault-backed account is not reachable through the model runtime
- **WHEN** a plugin runs a completion through its model runtime with provider `anthropic-work`, which only a vault-backed account provides
- **THEN** the provider has no credential, and the request fails as for any unconfigured provider
