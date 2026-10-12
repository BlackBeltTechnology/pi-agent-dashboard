## Purpose

Extend the credential vault with LLM credentials:
- OAuth accounts, either held by the hub or linked to its existing login;
- a single refresher per vault-held account;
- enrolment of additional accounts;
- LLM bindings (single, pool, clone provider ids), granted per project like env bindings, so that more than one account per provider can be used.

## ADDED Requirements

### Requirement: OAuth accounts
The vault SHALL accept accounts of kind `oauth` in addition to `key`. Each `oauth` account SHALL have one backend:
- `vault`: the tokens are stored in the vault file;
- `link`: the account refers to the hub's `~/.pi/agent/auth.json` entry for its provider.

The vault SHALL allow more than one `oauth` account for the same provider.

#### Scenario: Two Anthropic accounts coexist
- **WHEN** the user has linked the hub's `anthropic` login as "personal" and enrolled a vault-backed `anthropic` account "work"
- **THEN** the vault lists both accounts for `anthropic`, with their backends

### Requirement: Linking the existing login without a second refresher
The vault SHALL let the user link the hub's existing `auth.json` credential for a provider as an account.
- **No copy.** Linking SHALL NOT copy, move or modify the `auth.json` entry, and the vault SHALL never write `auth.json`.
- **Refresh.** A linked OAuth account SHALL be refreshed only through the path the dashboard server already uses for that entry.
- **Reuse.** The stored access token SHALL be reused while it has at least 5 minutes of lifetime remaining.
- **Unlink.** Revoking a linked account SHALL unlink it with the vault's revocation rules (cleared as a default; grants that override to it become `no-account`) and SHALL leave `auth.json` unchanged.
- **Rotate.** Rotating a linked account SHALL be done by signing in again through the existing provider flow. Where the provider exposes an account identity, the vault SHALL record it at link time, and a link whose upstream identity changes SHALL deliver nothing until the user confirms it.

#### Scenario: Linking leaves auth.json untouched
- **WHEN** the user links the hub's `anthropic` login as account "personal"
- **THEN** `auth.json` is byte-identical to before, and account "personal" is listed with backend `link`

#### Scenario: Valid stored token is reused without refresh
- **WHEN** a lease is requested from a linked account whose stored access token is valid for 30 more minutes
- **THEN** no upstream refresh is performed, and the stored access token is issued

#### Scenario: Linked refresh keeps the refresh token out of the vault
- **WHEN** a lease is requested from a linked account whose access token expires in 2 minutes
- **THEN** the token is refreshed through the server's existing `auth.json` credential path
- **AND** the vault file holds no copy of the refresh token

#### Scenario: Unlinking leaves auth.json untouched
- **WHEN** the user revokes linked account "personal", which is the default of binding `anthropic` and the override of a grant for project B
- **THEN** binding `anthropic` has no default, and project B's grant is `no-account`
- **AND** `auth.json` is byte-identical to before

### Requirement: Single refresher per vault-backed OAuth account
For OAuth accounts stored in the vault, the hub SHALL be the only party that uses the refresh token. The hub SHALL:
- serialise refreshes per account, with concurrent requests — from leases, proxied requests and plugin reads alike — sharing one upstream refresh;
- hold no file lock while the network refresh is in flight;
- propagate an abort signal to the refresh;
- persist the rotated refresh token before handing out any access token obtained from it.

Refreshing one account SHALL NOT block refreshing a different account of the same provider. If the account was revoked during the refresh, the minted token SHALL be discarded and nothing issued from it. If the account's tokens were replaced during the refresh, the minted token SHALL be discarded and the new record used. A vault-backed account SHALL never be written to `auth.json`. If the hub cannot persist a rotated refresh token, the account SHALL be marked `needs-reauth`.

#### Scenario: Concurrent lease requests trigger one refresh
- **WHEN** two sessions request a lease for the same expired vault-backed account at the same time
- **THEN** exactly one upstream refresh is performed, and both sessions receive an access token from it

#### Scenario: Lease and proxied request share one refresh
- **WHEN** a lease request and a proxied request need the same expired vault-backed account at the same time
- **THEN** exactly one upstream refresh is performed, and both use its access token

#### Scenario: Accounts of one provider refresh independently
- **WHEN** account "personal" is mid-refresh and a lease is requested for account "work" of the same provider
- **THEN** the "work" lease is served without waiting for the "personal" refresh

#### Scenario: Revoked during refresh
- **WHEN** an account is revoked while its refresh is in flight
- **THEN** the minted token is discarded, and no lease or proxied request uses it

#### Scenario: Vault-backed account is never written to auth.json
- **WHEN** a proxied request causes the hub to refresh vault-backed account "work"
- **THEN** `auth.json` is byte-identical to before, and the rotated tokens are stored only in the vault

### Requirement: LLM credential changes notify sessions
Every vault change that alters which LLM credential exists for a provider id — enrolment, re-enrolment, link, unlink, revocation, or an `llm` binding change — SHALL broadcast the existing credentials-updated notification, so sessions refresh their model lists.

#### Scenario: Enrolment refreshes model lists
- **WHEN** the user enrols account "work" behind clone binding `anthropic-work`, granted to a running session
- **THEN** the hub broadcasts credentials-updated, and the session's model list includes `anthropic-work` models

### Requirement: Token material never leaves the hub through management surfaces
No OAuth access token or refresh token SHALL appear in management API responses, the Settings UI, CLI output, logs or error messages. Status SHALL expose only non-secret fields, such as expiry, last refresh outcome and `needs-reauth`.

#### Scenario: Refresh failure is reported without material
- **WHEN** an OAuth refresh for an account fails
- **THEN** the log entry and any returned error name the account id and the failure kind, and contain no token material

### Requirement: LLM bindings
The vault SHALL support bindings with target `llm`, granted to projects with the same grants, checkout confirmation and `no-account` rules as env bindings.
- **Name.** An `llm` binding name SHALL match `^[a-z0-9][a-z0-9-]*$` and SHALL NOT contain `--`. A non-clone name SHALL be a provider id known to the hub. A clone name SHALL declare a base provider and SHALL NOT equal a built-in or hub `providers.json` provider id; a clone that later collides with one SHALL deliver nothing and be reported `name-conflict`.
- **Mode.** An `llm` binding SHALL be `single` (one default account) or `pool` (an ordered list of accounts, the first being the primary).
- **Delivery.**
  - Delivery `key` SHALL require `key` accounts.
  - Delivery `lease` SHALL require `oauth` accounts of a provider on the lease-supported list.
  - Delivery `proxy` SHALL require a provider whose API is proxy-capable, and `key` accounts or `oauth` accounts of a provider on the lease-supported list.
- **Accounts.** Every account a binding uses — its default, its pool members, and every grant override — SHALL belong to the binding's provider (its base provider, for clones). A grant override SHALL be allowed only on `single` bindings, and SHALL be of the same kind as the default.
- **Sharing.** A `key` account MAY back both `env` and `llm` bindings.
- **Kind guard.** Delivery SHALL re-check these rules and SHALL deliver nothing for a binding or grant that violates them.

#### Scenario: One account backs an env and an LLM binding
- **WHEN** the user binds a Gemini `key` account to env binding `GEMINI_API_KEY` and to LLM binding `google`
- **THEN** both bindings are listed and reference the same account

#### Scenario: Clone provider bound to a second account
- **WHEN** the user creates LLM binding `anthropic-work` as a clone of `anthropic`, with default account "work"
- **THEN** the binding is listed with base `anthropic` and account "work"
- **AND** binding `anthropic` keeps its own default account

#### Scenario: Binding rejects an account of the wrong provider
- **WHEN** the user binds LLM provider id `openai-codex` to an `anthropic` account
- **THEN** the request is rejected with a validation error, and no binding changes

#### Scenario: Clone name may not shadow a real provider
- **WHEN** the user creates a clone binding named `openai` with base `anthropic`
- **THEN** the request is rejected with a validation error

#### Scenario: Lease limited to supported providers
- **WHEN** the user creates a `lease` binding for a provider that is not on the lease-supported list
- **THEN** the request is rejected with the reason
- **AND** `proxy` delivery is offered only when it is allowed for that provider and account

#### Scenario: Project override picks a different account
- **WHEN** binding `anthropic` defaults to account "personal", and the grant for project B overrides it with account "work"
- **THEN** sessions in project B receive the "work" account for `anthropic`, and other granted projects receive "personal"

#### Scenario: Pool bindings take no override
- **WHEN** the user adds an account override to a grant of a pool binding
- **THEN** the request is rejected with a validation error

### Requirement: Pools are proxy-only and opt-in
A `pool` binding SHALL require `proxy` delivery, and its accounts SHALL be all `key` or all `oauth`. Pool failover SHALL be disabled by default. Enabling it SHALL require an explicit user action that acknowledges the provider-terms notice. A pool with failover disabled SHALL use only its primary account.

#### Scenario: Pool with lease delivery is rejected
- **WHEN** the user creates a pool binding with delivery `lease`
- **THEN** the request is rejected with a validation error

#### Scenario: Mixed pool is rejected
- **WHEN** the user creates a proxy pool binding with one `key` account and one `oauth` account
- **THEN** the request is rejected with a validation error

#### Scenario: New pool defaults to failover disabled
- **WHEN** the user creates a proxy pool binding with two accounts
- **THEN** the pool is stored with failover disabled
- **AND** only the primary account is used until the user enables failover

### Requirement: Additional OAuth account enrolment
The user SHALL be able to enrol an OAuth account for a provider that already has one. Enrolment SHALL run that provider's sign-in flow with the vault as destination and a user-supplied label, and SHALL NOT modify `~/.pi/agent/auth.json`.
- **Identity match.** When the provider exposes an account identity that matches an existing vault account, the vault SHALL replace that account's tokens and keep its id, instead of creating a duplicate.
- **Linked identity.** When the identity matches the hub's linked login for that provider, enrolment SHALL be refused, because the same upstream account would then have two refreshers.
- **No identity.** When no identity is available, the vault SHALL ask the user whether the enrolment is a new account or replaces a named one, and SHALL show a warning, which the user must explicitly confirm, that enrolling an account that is already linked creates a second refresher that may get the token family revoked.

#### Scenario: Second Anthropic account enrolled
- **WHEN** the user runs "Add account" for `anthropic` with label "work" while account "personal" exists
- **THEN** a new account "work" is stored
- **AND** account "personal" and `auth.json` are unchanged

#### Scenario: Enrolling the linked account is refused
- **WHEN** the user enrols an `anthropic` account whose provider identity equals that of the linked login "personal"
- **THEN** enrolment is refused with a message to use the link, and no account is stored

#### Scenario: No identity requires a confirmed warning
- **WHEN** the user enrols an account for a provider that exposes no account identity, while a linked login exists for that provider
- **THEN** enrolment proceeds only after the user confirms the second-refresher warning, and the confirmation is recorded in the vault event log

#### Scenario: Re-enrolling the same identity
- **WHEN** the user enrols an `anthropic` account whose provider identity equals that of account "work"
- **THEN** account "work" keeps its id and receives the new tokens, and no second account is created

### Requirement: Plugin reads of LLM bindings
A declared and approved `llm` binding SHALL return to the plugin:
- the key, for a `key` account;
- a current access token and never a refresh token, for an `oauth` account.

Plugin declarations and approvals follow the vault's plugin read access rules. Vault-backed accounts SHALL NOT be reachable through the provider-auth read or through the plugin model runtime. A linked account remains readable through the existing provider-auth read, because it is an `auth.json` record.

#### Scenario: OAuth binding returns no refresh token
- **WHEN** an approved plugin reads a declared `llm` binding whose default account is `oauth`
- **THEN** it receives an access token and no refresh token

#### Scenario: Vault-backed account is not reachable through the model runtime
- **WHEN** a plugin runs a completion through its model runtime with provider `anthropic-work`, which only a vault-backed account provides
- **THEN** the provider has no credential, and the request fails as for any unconfigured provider
