# model-proxy-credential-routing Specification

## Purpose
Rules for matching pi-ai models against the active credential set per provider: OAuth-vs-api-key routability, the hand-maintained per-model `oauthCompatible` override table, and a diagnostic surface exposing why each model is included in or excluded from `/v1/models`.

## Requirements

### Requirement: Credential-kind aware model filtering

The dashboard model proxy SHALL filter `/v1/models` and `find()` results by the *kind* of credential available for each model's provider, not only by provider presence.

For each model, the system SHALL include it in the available set only when at least one credential for its provider can route it:

- An `api_key` credential with non-empty `key` SHALL be considered able to route every model of that provider.
- An `oauth` credential with a non-empty `access` or `refresh` token SHALL be considered able to route a model only when that model's `oauthCompatible` flag is `true` (default) or absent.
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

### Requirement: Per-model OAuth compatibility flag

Each model entry in the registry SHALL carry an optional `oauthCompatible: boolean` flag (default `true` when omitted). Built-in models from pi-ai SHALL have the flag set automatically from a hand-maintained override table keyed by `(provider, modelId)`. Custom models from `~/.pi/agent/models.json` SHALL accept an explicit `oauthCompatible` field that overrides the default.

#### Scenario: Built-in model inherits flag from override table
- **WHEN** the override table marks `anthropic/claude-3-5-haiku-20241022` as OAuth-incompatible and the registry loads built-in pi-ai models
- **THEN** the loaded `claude-3-5-haiku-20241022` entry SHALL have `oauthCompatible: false`

#### Scenario: Built-in model not in override table defaults to compatible
- **WHEN** a built-in model id is not present in the override table
- **THEN** its registry entry SHALL have `oauthCompatible: true` (or omitted, treated as `true`)

#### Scenario: Legacy `-latest` alias in the live catalog stays denied under OAuth
- **WHEN** the registry's live catalog contains `anthropic/claude-3-5-haiku-latest` (a pre-4.x alias) and only an Anthropic OAuth credential is configured
- **THEN** the override table SHALL flag it `oauthCompatible: false` and `/v1/models` SHALL NOT list it
- **NOTE** the override table is maintained against the registry's *live* catalog (the pi-ai copy the proxy resolves via the tool registry) — NOT a standalone `node_modules` enumeration; the two can differ. Verify entries via `GET /api/model-proxy/diagnostics`.

#### Scenario: Custom model can opt out via models.json
- **WHEN** a custom model entry in `~/.pi/agent/models.json` sets `"oauthCompatible": false`
- **THEN** the registry SHALL preserve that flag and the credential-routing filter SHALL exclude the model under OAuth-only credentials

### Requirement: Diagnostic surface for excluded models

The registry SHALL expose every known model — including ones excluded by the credential-routing filter — through a diagnostic accessor that annotates each entry with the reason it was excluded (or `null` when included).

The set of reason values SHALL be:
- `null` — model is included in `/v1/models`
- `"no-credential"` — provider has no credential of any kind
- `"oauth-incompatible"` — provider has only an OAuth credential and the model is flagged `oauthCompatible: false`

A new `GET /api/model-proxy/diagnostics` endpoint (added by this change) SHALL include the reason for each model when present. No such endpoint exists today.

#### Scenario: Diagnostic shows excluded reason for OAuth-incompatible model
- **WHEN** the user queries `/api/model-proxy/diagnostics` with only an Anthropic OAuth credential configured
- **THEN** the entry for `anthropic/claude-3-5-haiku-20241022` SHALL include `excludedReason: "oauth-incompatible"`

#### Scenario: Diagnostic shows null reason for included model
- **WHEN** the same diagnostic is queried for `anthropic/claude-haiku-4-5`
- **THEN** the entry SHALL include `excludedReason: null` (or omit the field)

#### Scenario: Diagnostic shows no-credential reason for unconfigured provider
- **WHEN** no credential is configured for `openai`
- **THEN** every `openai/*` entry SHALL include `excludedReason: "no-credential"`

### Requirement: OAuth token refresh SHALL propagate a concrete abort signal

pi 0.84.1 requires config-form extension OAuth `refreshToken(credentials, signal)` callbacks to accept and honor a concrete abort signal. The dashboard's internal auth storage SHALL pass a real `AbortSignal` on every OAuth refresh it initiates, and SHALL NOT call the callback with the credentials argument alone.

A refresh failure SHALL NOT be silently swallowed. The request SHALL either fail with an error, or use a credential that another writer stored. The error is the refresh failure itself, or a more specific coordination outcome that explains it (the credential was removed, replaced, or corrupt). A stored credential is used only if, by the time of the failure, another writer has stored a different credential for the provider that is valid beyond the refresh buffer. Both cases are defined by "OAuth refresh SHALL coordinate with other auth.json writers". See change: harden-auth-json-lock-coordination.

#### Scenario: Refresh is invoked with a signal

- **WHEN** the internal auth storage refreshes an OAuth credential
- **THEN** it SHALL pass a concrete `AbortSignal` as the second argument to `refreshToken`

#### Scenario: Aborted refresh stops cleanly

- **WHEN** the supplied signal aborts while an OAuth refresh is in flight
- **THEN** the refresh SHALL stop
- **AND** no partially-refreshed credential SHALL be persisted

#### Scenario: Refresh failure does not persist a broken credential

- **WHEN** an OAuth refresh rejects
- **AND** `auth.json` holds no different credential for the provider that is valid beyond the refresh buffer
- **THEN** the previously stored credential SHALL be left intact
- **AND** the failure SHALL be surfaced to the caller rather than silently swallowed

### Requirement: A newly catalogued subscription model SHALL be reachable without a provider-key remap

The credential-kind filter matches a model to a credential by the model's `provider` field against the auth-key under which the credential is stored. Where the upstream catalog publishes a model once per subscription channel — carrying the subscription-specific provider id on the entry itself — no remap is required, and the dashboard SHALL NOT introduce one. The dashboard SHALL verify reachability from the catalog rather than assume it, and SHALL NOT add prefix-, substring-, or heuristic-based provider matching to the filter.

A remap SHALL be introduced only if a future catalog publishes a model whose `provider` differs from every auth-key that can route it, and then only as an explicit enumerated mapping.

#### Scenario: Subscription-catalogued model is listed for its subscription credential

- **GIVEN** `~/.pi/agent/auth.json` holds only an OAuth credential under the `openai-codex` auth key
- **AND** the registry contains a model entry whose `provider` is `openai-codex`
- **WHEN** `/v1/models` is queried
- **THEN** that model SHALL be listed
- **AND** `find("openai-codex", <id>)` SHALL return its entry

#### Scenario: The same model id under a different provider is filtered independently

- **GIVEN** the catalog publishes the same model id under more than one provider (for example an API-key provider and a subscription provider)
- **AND** a credential exists for only one of those providers
- **WHEN** `/v1/models` is queried
- **THEN** only the entry whose `provider` has a credential SHALL be listed
- **AND** the credential SHALL NOT be used to route the other provider's entry

#### Scenario: No heuristic provider matching is introduced

- **GIVEN** an auth key and a model provider that are not equal
- **WHEN** the credential-kind filter evaluates the model
- **THEN** the model SHALL be excluded unless an explicit enumerated mapping pairs the two
- **AND** no prefix or substring match SHALL be used to bridge them

### Requirement: A provider gate enforced by upstream client-version headers SHALL NOT be modelled as an OAuth incompatibility

Where an upstream provider rejects a model for a subscription credential because of the client-version headers the runtime sends — rather than because the model is unavailable to subscription credentials at all — the dashboard SHALL NOT add that model to the per-provider OAuth-incompatibility list. The `oauthCompatible` flag SHALL remain reserved for models that genuinely cannot be routed by an OAuth credential. A client-version rejection SHALL be resolved by moving the pinned runtime, and the dashboard SHALL NOT construct or override client-version headers itself.

#### Scenario: Version-gated model is not added to the incompatibility list

- **GIVEN** an upstream model that returns a client-version-too-old rejection under the previously pinned runtime
- **AND** the same model succeeds with the newly pinned runtime and the same credential
- **WHEN** the OAuth-compatibility list is evaluated
- **THEN** that model SHALL NOT be flagged `oauthCompatible: false`
- **AND** it SHALL appear in `/v1/models` for an OAuth-only credential

#### Scenario: Dashboard does not set client-version headers

- **WHEN** the model proxy issues an upstream request on behalf of a subscription credential
- **THEN** it SHALL NOT set or override the client-version or client user-agent headers
- **AND** those headers SHALL be whatever the pinned runtime constructs

### Requirement: OAuth refresh SHALL survive relocation of the runtime's OAuth entry point

Credential refresh for OAuth-credentialed providers SHALL use the OAuth implementation carried by the runtime's own provider definitions, never a dashboard-maintained loader or module-path table, so a relocation inside pi cannot break it. When a provider exposes no OAuth implementation, the condition SHALL fail diagnosably rather than crash.

#### Scenario: Refresh works after relocation

- **WHEN** a stored OAuth credential needs refreshing
- **THEN** the refresh SHALL be performed by the provider definition the runtime holds for that provider
- **AND** the refreshed credential SHALL be used for the upstream request

#### Scenario: Empty OAuth entry point does not crash the credential path

- **WHEN** a provider holding an OAuth credential exposes no OAuth implementation in the runtime
- **THEN** the credential path SHALL NOT raise a type error
- **AND** the condition SHALL be reported as a missing OAuth capability for that provider

#### Scenario: api-key providers are unaffected by missing OAuth

- **WHEN** no usable OAuth implementation is reachable for a provider
- **THEN** models whose provider has an api-key credential SHALL remain routable
- **AND** only OAuth-credentialed models SHALL be reported as unavailable

#### Scenario: OAuth-incompatible filtering is preserved

- **WHEN** a provider holds only an OAuth credential
- **THEN** models flagged OAuth-incompatible SHALL continue to be excluded from the available set exactly as specified today

### Requirement: OAuth refresh SHALL coordinate with other auth.json writers
The dashboard's internal auth storage shares `auth.json` with pi processes that refresh the same OAuth credentials. When a credential needs refreshing (it expires within the refresh buffer), the internal auth storage SHALL take its starting point from a read of `auth.json` performed under the `auth.json` lock, not from its in-memory snapshot. That read SHALL follow the existing corrupt-content read tolerance (quarantine, never throw on content). Corrupt content SHALL fail the refresh, not the read. It SHALL NOT hold the lock across its own network refresh.

Persisting a refreshed credential SHALL be a compare-and-swap under the lock. The write SHALL happen only if the stored credential is equal, in every field, to the credential the refresh started from. Otherwise nothing SHALL be written and:
- a stored OAuth credential that is valid beyond the refresh buffer SHALL be used;
- any other outcome SHALL fail the request with an error naming the outcome: changed-and-expired, removed, replaced by a non-OAuth credential, corrupt (unparseable) content, or lock contention after the refresh path's window is exhausted.

A credential removed while a refresh was in flight SHALL NOT be recreated. Neither the credential nor `auth.json` itself SHALL be created by this path: an absent `auth.json` is the removed outcome. Corrupt `auth.json` content SHALL NOT be written over by a refresh. A refreshed credential that could not be persisted SHALL NOT be used for the request. Lock waits on this path SHALL be non-blocking and SHALL be bounded by a window that exceeds pi's OAuth refresh timeout (a 15-second abort signal as of pi 0.86.1) and stays below the lock staleness threshold. No credential material SHALL appear in any error message or log line produced by this coordination. See change: harden-auth-json-lock-coordination.

#### Scenario: Fresher on-disk credential is adopted without a refresh
- **WHEN** the in-memory credential for a provider expires within the refresh buffer but `auth.json` holds an OAuth credential for it that is valid beyond the refresh buffer, written by another process
- **THEN** the internal auth storage SHALL use the on-disk credential for the request
- **AND** SHALL NOT call the provider's refresh

#### Scenario: Waiting out a concurrent pi refresh avoids a second refresh
- **WHEN** a refresh is needed while another process holds the `auth.json` lock for several seconds (longer than the interactive 2-second window) and stores a fresh credential before releasing it
- **THEN** the internal auth storage SHALL wait for the lock rather than fail
- **AND** SHALL adopt the stored credential without calling the provider's refresh

#### Scenario: Refresh spends the on-disk refresh token
- **WHEN** a refresh is needed and the on-disk credential's refresh token differs from the in-memory one
- **THEN** the refresh SHALL be invoked with the on-disk credential's refresh token

#### Scenario: Unchanged credential is replaced by the refreshed one
- **WHEN** a refresh completes and the stored credential is equal in every field to the one the refresh started from
- **THEN** the refreshed credential SHALL be written to `auth.json` and used for the request

#### Scenario: Credential changed during the refresh is not overwritten
- **WHEN** another writer stores a different OAuth credential for the provider, valid beyond the refresh buffer, while the dashboard's refresh is in flight
- **THEN** the dashboard SHALL NOT write its refreshed credential
- **AND** the stored credential SHALL remain byte-identical in `auth.json` and SHALL be used for the request

#### Scenario: A change to a non-token field is not overwritten
- **WHEN** another writer changes only a non-token field of the provider's credential (for example `enterpriseUrl` or `expires`) while the dashboard's refresh is in flight
- **THEN** the dashboard SHALL NOT write its refreshed credential over it

#### Scenario: Changed but expired credential fails diagnosably
- **WHEN** the stored credential changed during the refresh and is not valid beyond the refresh buffer
- **THEN** nothing SHALL be written
- **AND** the request SHALL fail with an error stating the credential changed during the refresh

#### Scenario: Credential removed during the refresh is not resurrected
- **WHEN** the provider's credential is removed from `auth.json` while the dashboard's refresh is in flight
- **THEN** `auth.json` SHALL NOT contain a credential for that provider afterwards
- **AND** the request SHALL fail with an error stating the credential was removed

#### Scenario: Credential replaced by an api key during the refresh
- **WHEN** the provider's OAuth credential is replaced by an `api_key` credential while the dashboard's refresh is in flight
- **THEN** the stored `api_key` credential SHALL remain unchanged
- **AND** the request SHALL fail with an error stating the credential was replaced, without using the api key as an OAuth token

#### Scenario: Corrupt auth.json is not written over by a refresh
- **WHEN** `auth.json` holds unparseable content at snapshot or persist time
- **THEN** the refresh SHALL NOT write `auth.json`
- **AND** the request SHALL fail with an error identifying corrupt content, distinct from the removal error

#### Scenario: Absent auth.json is not created by a refresh
- **WHEN** a refresh is needed and `auth.json` does not exist
- **THEN** `auth.json` SHALL still not exist afterwards
- **AND** the request SHALL fail with the removal error

#### Scenario: Persist blocked past the refresh window discards the minted credential
- **WHEN** the network refresh succeeds but the `auth.json` lock stays held past the refresh path's window at persist time
- **THEN** nothing SHALL be written
- **AND** the request SHALL fail with a lock-contention error rather than use the unpersisted credential

#### Scenario: Failed refresh recovers from a concurrently stored credential
- **WHEN** the provider rejects the dashboard's refresh and, by the time of the rejection, `auth.json` holds a different OAuth credential that is valid beyond the refresh buffer
- **THEN** the internal auth storage SHALL use the stored credential for the request instead of surfacing the refresh failure

#### Scenario: Failed refresh explained by a concurrent removal
- **WHEN** the provider rejects the dashboard's refresh and, by the time of the rejection, the credential has been removed from `auth.json`
- **THEN** the request SHALL fail with the removal error rather than the provider's rejection
- **AND** `auth.json` SHALL NOT contain a credential for that provider

#### Scenario: Network refresh does not hold the auth.json lock
- **WHEN** an OAuth refresh is in flight for the internal auth storage
- **THEN** a concurrent dashboard credential write for a different provider SHALL acquire the `auth.json` lock and complete without waiting for the refresh to finish

### Requirement: The server SHALL use a single model runtime

The dashboard server SHALL hold exactly one pi model runtime. The model proxy, `GET /api/models`, the plugin model runtime and the provider-auth login-flow listing SHALL all answer from it. No server path SHALL construct a second runtime or a parallel model registry.

#### Scenario: Catalogue and login flows agree
- **WHEN** a provider appears in the provider-auth OAuth flow list
- **THEN** that provider's models SHALL be the ones the model proxy and `/api/models` report for it

#### Scenario: Custom provider visible everywhere
- **WHEN** a custom provider is configured in `providers.json`
- **THEN** its models SHALL be listed by `/api/models`, routable through the proxy, and visible to plugins through the plugin model runtime

#### Scenario: Removed custom provider disappears
- **WHEN** a custom provider, or one of its fields such as `apiKey`, is removed from `providers.json`
- **THEN** the runtime SHALL no longer list the provider, or SHALL no longer use the removed field

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
