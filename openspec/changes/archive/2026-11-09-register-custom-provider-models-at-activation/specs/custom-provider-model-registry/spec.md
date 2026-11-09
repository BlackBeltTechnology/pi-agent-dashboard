## MODIFIED Requirements

### Requirement: pi sessions SHALL continue to receive custom providers via the bridge extension

The extension's per-session `registerProvider()` path (globally registered bridge) is unchanged: interactive sessions, flows, subagents, and standalone `pi` runs continue to get custom providers that way. `preRegisterProviderAuth` SHALL be retained to close the newly-added-provider spawn window (auth available before the ~10s `/v1/models` discovery resolves). The extension SHALL NOT write `models.json`.

Before the bridge's activation completes, every custom provider in `providers.json` that has a usable entry in a bridge-owned discovery cache SHALL be registered with that cached model list, without network access. An entry is usable when it is non-empty and was recorded for the provider's current `baseUrl` and current API key. When pi was started naming a custom provider `<p>` without a usable cache entry — via `--provider <p>`, or via `--model <p>/<id>` where `<p>` is the text before the first `/` — compared case-insensitively, activation SHALL additionally run a live `/v1/models` discovery for `<p>` alone, bounded by 5 seconds, and register its models before completing. No other provider's discovery SHALL delay activation. As a result a pi process started with `--model <custom-provider>/<id>` resolves that model at startup whenever the provider is cached or answers within the bound.

Every successful, non-empty live discovery (startup, background, re-sync or explicit refresh) SHALL record that provider's model ids and advertised metadata in the cache; a failed or empty discovery SHALL NOT change the cache. The cache SHALL NOT contain API keys, tokens or header values; it MAY contain a one-way fingerprint of the key. Concurrent pi processes writing the cache SHALL NOT remove each other's provider entries. A startup discovery that fails or times out SHALL be logged with the provider name, SHALL NOT fail activation, and the provider SHALL fall back to the existing background discovery. Background discovery SHALL keep running for every provider as before, including providers registered from the cache, and re-sync and explicit refresh SHALL keep working as before, replacing any startup list with the freshly discovered one.

#### Scenario: Spawned session resolves a custom-provider model

- **GIVEN** a custom provider in `providers.json` and a role/ref pointing at one of its models
- **WHEN** a flow or subagent session is spawned and resolves that ref
- **THEN** resolution SHALL succeed via the inherited/registered session registry
- **AND** SHALL NOT require the dashboard server to be running

#### Scenario: Startup --model naming a cached custom-provider model

- **GIVEN** provider `proxy` in `providers.json` and a cache entry for `proxy` listing `cc/claude-sonnet-5-5`
- **WHEN** pi is started with `--model proxy/cc/claude-sonnet-5-5`
- **THEN** pi SHALL start on that model and the bridge SHALL register with the dashboard
- **AND** activation SHALL NOT wait on a network request to `proxy`

#### Scenario: Startup --model with a cold cache

- **GIVEN** provider `proxy` in `providers.json`, no cache entry, and `/v1/models` answering within the timeout with `cc/claude-sonnet-5-5`
- **WHEN** pi is started with `--model proxy/cc/claude-sonnet-5-5`
- **THEN** pi SHALL start on that model
- **AND** the cache SHALL afterwards hold `proxy`'s discovered model ids

#### Scenario: Unreachable provider not named by --model adds no startup delay

- **GIVEN** provider `down` whose `/v1/models` never answers and has no cache entry
- **WHEN** pi starts without a `--model` naming `down`
- **THEN** activation SHALL NOT wait on `down`
- **AND** `down`'s auth SHALL be registered and its background discovery SHALL still run

#### Scenario: Unreachable provider named by --model is bounded

- **GIVEN** provider `down` whose `/v1/models` never answers and has no cache entry
- **WHEN** pi starts with `--model down/x`
- **THEN** activation SHALL complete within 5 seconds of starting that discovery
- **AND** a log line SHALL name `down` and the failure

#### Scenario: Cache entry for a changed baseUrl or key is ignored

- **GIVEN** a cache entry for `proxy` recorded under a different `baseUrl` or a different API key than the current `providers.json` entry
- **WHEN** the bridge activates
- **THEN** the entry SHALL NOT be used and `proxy` SHALL be discovered live

#### Scenario: Failed discovery does not poison the cache

- **GIVEN** a cache entry for `proxy` listing models A and B
- **WHEN** a later discovery for `proxy` fails or returns an empty list
- **THEN** the cache entry SHALL still list A and B

#### Scenario: Concurrent writers keep each other's entries

- **GIVEN** two pi processes that each successfully discover a different provider
- **WHEN** both write the cache
- **THEN** the cache SHALL afterwards hold an entry for each provider

#### Scenario: --provider form with a cold cache

- **GIVEN** provider `proxy` with no cache entry, answering within the bound
- **WHEN** pi is started with `--provider proxy --model cc/claude-sonnet-5-5`
- **THEN** pi SHALL start on `proxy/cc/claude-sonnet-5-5`

#### Scenario: Explicit refresh updates the cache

- **GIVEN** a cache entry for `proxy` listing model A
- **WHEN** the user forces a refresh of `proxy` and discovery returns A and B
- **THEN** the cache entry SHALL list A and B

#### Scenario: Cache holds no credentials

- **WHEN** the bridge writes the discovery cache after a successful discovery
- **THEN** the written file SHALL contain no API key, token or header value from `providers.json`

#### Scenario: Background discovery replaces the startup list

- **GIVEN** `proxy` was registered at activation from a cache listing models A and B
- **WHEN** background discovery returns A and C
- **THEN** the registered `proxy` models SHALL be A and C
- **AND** the cache entry SHALL be updated to A and C
