## MODIFIED Requirements

### Requirement: Credential-kind aware model filtering

The dashboard model proxy SHALL filter `/v1/models` and `find()` results by the *kind* of credential available for each model's provider, not only by provider presence.

The credential set a request is evaluated against SHALL be:
- for a request authenticated with a session proxy key owned by vault delivery: only the credential of that key's binding, keyed by the binding's provider id (including clone ids and pool members);
- for every other request, including `/api/models` and the plugin model runtime: the credentials in `auth.json` only, as before. Provider ids that only vault bindings provide (clone ids, pool members, bindings to vault-backed accounts) SHALL have no credential outside an owned-key request.

For each model, the system SHALL include it in the available set only when at least one credential for its provider, in that credential set, can route it:

- An `api_key` credential, or a vault `key` binding, with a non-empty key SHALL be considered able to route every model of that provider.
- An `oauth` credential with a non-empty `access` or `refresh` token, or a vault `oauth` binding, SHALL be considered able to route a model only when that model's `oauthCompatible` flag is `true` (default) or absent. A clone provider id SHALL use the flags of the base provider its binding explicitly declares.
- A provider with no credential at all SHALL exclude all of its models, as today.

#### Scenario: OAuth-only credential excludes legacy snapshot
- **WHEN** `~/.pi/agent/auth.json` has only an `anthropic` OAuth credential and the registry contains `anthropic/claude-3-5-haiku-20241022` (flagged `oauthCompatible: false`)
- **THEN** `/v1/models` SHALL NOT list that model and `registry.find("anthropic", "claude-3-5-haiku-20241022")` SHALL return `null`

#### Scenario: OAuth-only credential includes current allowlist model
- **WHEN** the same OAuth-only setup queries `anthropic/claude-haiku-4-5` (default `oauthCompatible: true`)
- **THEN** `/v1/models` SHALL list that model and `find()` SHALL return its entry

#### Scenario: API key credential routes every model of its provider
- **WHEN** `auth.json` has an `anthropic` `api_key` credential (with no OAuth credential)
- **THEN** every Anthropic model in the registry SHALL appear in `/v1/models`, including ones flagged `oauthCompatible: false`

#### Scenario: No credential excludes provider entirely
- **WHEN** `auth.json` has no credential for `openai`
- **THEN** no `openai/*` model SHALL appear in `/v1/models`

#### Scenario: Owned session key sees its vault binding
- **WHEN** a request carries a session proxy key owned by vault delivery for binding `anthropic-work` (an `oauth` clone of `anthropic`), and `auth.json` has no `anthropic-work` entry
- **THEN** `/v1/models` SHALL list the `anthropic-work` models whose base `anthropic` models are `oauthCompatible`

#### Scenario: Other callers do not see vault bindings
- **WHEN** a request without an owned session key lists `/v1/models`, or `/api/models` is requested, and the vault holds a proxy binding `anthropic-work`
- **THEN** no `anthropic-work/*` model SHALL appear

### Requirement: Credential writes through the model runtime SHALL keep the dashboard's auth.json guarantees

Every `auth.json` write the model runtime triggers (OAuth refresh, credential removal) SHALL go through the dashboard's credential store, which SHALL:
- never hold the `auth.json` lock across a network call;
- persist with an atomic replace, so a crash never leaves a truncated `auth.json`;
- refuse to write over unparseable `auth.json` content that has not been quarantined;
- serialize credential mutations of one provider within the server process;
- never create `auth.json` when removing a credential;
- recover a failed refresh from a credential another writer stored meanwhile, exactly as the coordination requirement specifies;
- keep credential material out of every error message and log line.

The runtime's own default file store SHALL NOT be used by the server. Concurrent requests for one provider SHALL cause at most one call to its refresh endpoint, also when that refresh fails.

Credentials held by the credential vault (see `vault-llm-credentials`) are not `auth.json` credentials. Inside a request authenticated with a session proxy key owned by vault delivery, the runtime SHALL receive a vault-held credential only as an already-resolved key from the vault, and SHALL NOT refresh, write or remove it; the vault refreshes it. For vault-held credentials the unit of serialisation and of the at-most-one-refresh rule SHALL be the vault account, not the provider id, so two accounts of one provider refresh independently and never share a refresh with an `auth.json` credential of the same provider.

#### Scenario: Runtime-triggered refresh does not hold the lock over the network
- **WHEN** the runtime refreshes an expiring OAuth credential and the provider's token endpoint takes 5 seconds to answer
- **THEN** another process SHALL be able to acquire the `auth.json` lock during those 5 seconds

#### Scenario: Two concurrent requests refresh once
- **WHEN** two proxy requests for the same provider arrive while its OAuth credential is expiring
- **THEN** the provider's refresh endpoint SHALL be called at most once by the server

#### Scenario: Two concurrent requests share one failed refresh
- **WHEN** two proxy requests for the same provider arrive while its OAuth credential is expiring and the provider rejects the refresh
- **THEN** the refresh endpoint SHALL be called once and both requests SHALL fail with that refresh error

#### Scenario: Ambient environment keys do not change the listed catalogue
- **WHEN** `auth.json` holds no credential for a provider but the server's environment exports that provider's API key
- **THEN** `/api/models` SHALL NOT list that provider's models

#### Scenario: Crash during persist leaves a valid file
- **WHEN** the server process is killed while persisting a refreshed credential
- **THEN** `auth.json` SHALL contain either the previous or the new complete content

#### Scenario: Corrupt auth.json is not overwritten by the runtime
- **WHEN** `auth.json` is unparseable and the runtime attempts a credential write
- **THEN** the write SHALL be refused and the original bytes SHALL be preserved in a quarantine copy

#### Scenario: Vault account and auth.json login of one provider do not share a refresh
- **GIVEN** `auth.json` holds an expired `anthropic` login, and an owned-key request uses vault-backed `anthropic` account "work", also expired
- **WHEN** an unowned request for `anthropic` and the owned-key request arrive concurrently
- **THEN** exactly one refresh runs per credential (two in total), "work" is persisted only in the vault, and `auth.json` receives only its own login's rotation
