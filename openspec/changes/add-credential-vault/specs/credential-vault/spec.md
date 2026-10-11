## Purpose

Give the dashboard one hub-owned, account-keyed store for every credential (LLM OAuth, LLM API keys, service secrets), with bindings and per-project allowlists, so credentials can be managed, rotated, scoped and delivered from a single place.

## ADDED Requirements

### Requirement: Account-keyed credential storage
The vault SHALL store credentials as accounts. Each account SHALL have a stable id, a provider, a kind (`oauth`, `api_key` or `secret`), a user-visible label and a storage backend. The vault SHALL allow more than one account for the same provider. The vault file SHALL be owner-only (mode `0600` on POSIX; on Windows, following the repository's existing best-effort convention) and written atomically under a lock. It SHALL NOT be created until the first vault-backed account is added. The vault SHALL reject secret values shorter than 8 characters.

#### Scenario: Two accounts for the same provider coexist
- **WHEN** the user adds an `oauth` account labelled "personal" and a second `oauth` account labelled "work", both for provider `anthropic`
- **THEN** the vault lists two distinct accounts for `anthropic`, each with its own id and label, and neither overwrites the other

#### Scenario: Vault file permissions
- **WHEN** the first vault-backed account is added on POSIX
- **THEN** the vault file exists with mode `0600`

#### Scenario: No file before the first account
- **WHEN** the dashboard starts with no vault accounts and the user only views the vault page
- **THEN** no vault file is created

#### Scenario: Concurrent writes do not lose updates
- **WHEN** two account additions are submitted concurrently
- **THEN** both accounts are present after both requests complete

#### Scenario: Too-short secret rejected
- **WHEN** the user adds a `secret` account whose value is 5 characters long
- **THEN** the request is rejected with a validation error and nothing is stored

### Requirement: Linking the existing login without a second refresher
The vault SHALL let the user link the hub's existing `~/.pi/agent/auth.json` credential for a provider as an account. The linked account's tokens SHALL remain in `auth.json` and SHALL be refreshed only by the processes that refresh `auth.json` today. Linking SHALL NOT copy, move or modify the `auth.json` entry.

#### Scenario: Linking leaves auth.json untouched
- **WHEN** the user links the hub's `anthropic` login as account "personal"
- **THEN** `auth.json` is byte-identical to before and account "personal" is listed with a link backend

#### Scenario: Linked account refresh does not create a second refresher
- **WHEN** a lease is issued from a linked account whose access token has expired
- **THEN** the token is refreshed through the same locked `auth.json` path that local pi sessions use, and the vault file holds no copy of the refresh token

### Requirement: Single refresher per vault-backed OAuth account
For OAuth accounts stored in the vault, the hub SHALL be the only party that uses the refresh token. Refreshes SHALL be serialised per account. The rotated refresh token SHALL be persisted before any access token obtained from it is handed out. Refreshing one account SHALL NOT block refreshing a different account of the same provider.

#### Scenario: Concurrent lease requests trigger one refresh
- **WHEN** two sessions request a lease for the same expired vault-backed account at the same time
- **THEN** exactly one upstream refresh is performed and both sessions receive an access token from it

#### Scenario: Accounts of one provider refresh independently
- **WHEN** account "personal" is mid-refresh and a lease is requested for account "work" of the same provider
- **THEN** the "work" lease is served without waiting for the "personal" refresh

### Requirement: Secret values never leave the hub through management surfaces
Management APIs, the Settings UI, logs and error messages SHALL NOT contain any of the following:
- a stored secret value;
- an OAuth access token;
- an OAuth refresh token.

Listings SHALL expose only the following:
- account id, provider, kind and label;
- backend;
- binding membership;
- non-secret status, such as expiry and last refresh outcome.

#### Scenario: Listing redacts values
- **WHEN** a client requests the account list
- **THEN** the response contains no secret value, access token or refresh token for any account

#### Scenario: Refresh failure is logged without material
- **WHEN** an OAuth refresh for an account fails
- **THEN** the log entry names the account id and the failure kind and contains no token material

### Requirement: Bindings
The vault SHALL map bindings to accounts.
- **Targets.** A binding SHALL have a target: `env` (the binding id is an environment variable name) or `llm` (the binding id is a pi provider id).
- **Reuse.** One account MAY back several bindings.
- **Modes.** A binding SHALL be `single` (exactly one account) or `pool` (an ordered list of accounts with a primary).
- **OAuth delivery.** An `llm` binding to an `oauth` account SHALL declare a delivery mode, `lease` or `proxy`.
- **Clones.** An `llm` binding MAY declare a clone provider id (e.g. `anthropic-work`) that inherits the API and model list of a named base provider.

#### Scenario: One account backs an env and an LLM binding
- **WHEN** the user binds a Gemini key account to env binding `GEMINI_API_KEY` and to LLM binding `google`
- **THEN** both bindings are listed and both reference the same account

#### Scenario: Clone provider bound to a second account
- **WHEN** the user creates LLM binding `anthropic-work` as a clone of `anthropic`, bound to account "work"
- **THEN** the binding is listed with base provider `anthropic` and account "work"
- **AND** binding `anthropic` remains bound to its own account

#### Scenario: Binding rejects an account of the wrong provider
- **WHEN** the user binds LLM provider id `openai-codex` to an `anthropic` account
- **THEN** the request is rejected with a validation error and no binding changes

### Requirement: Pools are proxy-only and opt-in
A `pool` binding SHALL require `proxy` delivery. Pool failover SHALL be disabled by default. Enabling it SHALL require an explicit user action that acknowledges the provider-terms notice. A pool with failover disabled SHALL behave as `single` on its primary account.

#### Scenario: Pool with lease delivery is rejected
- **WHEN** the user creates a pool binding with delivery mode `lease`
- **THEN** the request is rejected with a validation error

#### Scenario: New pool defaults to failover disabled
- **WHEN** the user creates a proxy pool binding with two accounts
- **THEN** the pool is stored with failover disabled, and only the primary account is used until the user enables failover

### Requirement: Per-project allowlist, default deny
The vault SHALL deliver a binding to a session only when the allowlist for that session's project key names the binding. A project with no allowlist entry SHALL receive nothing.
- The project key SHALL be the normalised `origin` git remote URL of the session's working directory when one exists.
- Otherwise the project key SHALL be the pair (authenticated device id, absolute working directory).

The allowlist SHALL be documented as least-privilege scoping, not as an authentication boundary.

#### Scenario: Unlisted project receives nothing
- **WHEN** a session starts in a project that has no allowlist entry
- **THEN** no vault credential is delivered to it

#### Scenario: Same repository on two machines shares an allowlist
- **WHEN** the allowlist grants `GEMINI_API_KEY` to the project whose remote normalises to `github.com/acme/app`
- **AND** sessions start in clones of that repository on two paired devices at different paths
- **THEN** both sessions are eligible for `GEMINI_API_KEY`

#### Scenario: Repository without a remote is keyed per device
- **WHEN** the allowlist grants a binding to (device A, `/work/scratch`) and a session starts in `/work/scratch` on device B
- **THEN** the session on device B receives nothing

### Requirement: Account rotation and revocation
The user SHALL be able to replace an account's secret (rotate) and to revoke an account. Rotation and revocation SHALL be propagated to sessions that hold an affected binding (see `credential-delivery`). A revoked account SHALL be removed from every binding. A binding left with no account SHALL deliver nothing.

#### Scenario: Revoking the only account of a binding
- **WHEN** the user revokes the account bound to `SONIOX_API_KEY`
- **THEN** the binding delivers nothing
- **AND** sessions that held the binding are told to withdraw it

### Requirement: Additional OAuth account enrolment
The user SHALL be able to enrol an OAuth account for a provider that already has one. Enrolment SHALL run that provider's sign-in flow with the vault as the destination and a user-supplied label, and SHALL NOT modify `~/.pi/agent/auth.json`.
- When the provider exposes an account identity and it matches an existing account, the vault SHALL update that account's tokens instead of creating a duplicate.
- When no identity is available, the vault SHALL ask the user whether the enrolment is a new account or replaces a named one.

#### Scenario: Second Anthropic account enrolled
- **WHEN** the user runs "Add account" for `anthropic` with label "work" while account "personal" exists
- **THEN** a new account "work" is stored
- **AND** account "personal" and `auth.json` are unchanged

#### Scenario: Re-enrolling the same identity
- **WHEN** the user enrols an `anthropic` account whose provider identity equals that of account "work"
- **THEN** account "work" receives the new tokens and no second account is created

### Requirement: Non-destructive import of service secrets
The vault SHALL offer an import that reads known skill `.env` files and `~/.pi/agent/system-one/auth.json`, proposes `secret` accounts, and creates only the accounts the user confirms. Import SHALL NOT modify or delete the source files. LLM credentials in `auth.json` SHALL be offered only through linking, never by copy.

#### Scenario: Import leaves sources untouched
- **WHEN** the user imports `GEMINI_API_KEY` from a skill `.env` file
- **THEN** a vault account exists for it and the `.env` file is byte-identical to before

### Requirement: Plugin read access through declared bindings
Server plugins SHALL be able to read a vault binding only when the plugin's manifest declares that binding id and the user has approved it. Plugin access SHALL NOT expose any of the following:
- other bindings;
- account listings;
- OAuth refresh tokens of vault-backed accounts.

The existing per-plugin credential store (`plugin-credential-store`) SHALL keep its current behaviour.

#### Scenario: Undeclared binding is refused
- **WHEN** a plugin that declares only `POLY_PIZZA_KEY` requests `GEMINI_API_KEY`
- **THEN** the request returns no value

#### Scenario: Declared but unapproved binding is refused
- **WHEN** a plugin declares `POLY_PIZZA_KEY` and the user has not approved it
- **THEN** the request returns no value
