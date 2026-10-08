## ADDED Requirements

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

## MODIFIED Requirements

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
