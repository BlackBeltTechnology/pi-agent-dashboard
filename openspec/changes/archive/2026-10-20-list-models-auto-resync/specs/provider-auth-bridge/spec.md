# Spec Delta

## MODIFIED Requirements

### Requirement: Bridge hot-reloads providers.json on credentials_updated
When the bridge extension receives a `credentials_updated` message, it SHALL re-read `~/.pi/agent/providers.json`, diff it against the last-registered provider snapshot, and call `pi.registerProvider(...)` for new or changed entries and `pi.unregisterProvider(...)` for removed entries — BEFORE invoking `modelRegistry.refresh()`. This ensures the model registry's subsequent refresh observes the newly-registered providers.

#### Scenario: New provider added to providers.json
- **WHEN** a new `{ name, baseUrl, apiKey, api }` entry is added to `~/.pi/agent/providers.json`
- **AND** the server broadcasts `{ type: "credentials_updated" }`
- **THEN** the bridge SHALL call `pi.registerProvider(name, ...)` with models discovered from the provider's `/v1/models` endpoint (or an empty models list if discovery fails)
- **AND** the subsequent `modelRegistry.refresh()` SHALL include the new provider's models in `getAvailable()`

#### Scenario: Existing provider removed from providers.json
- **WHEN** an existing entry is removed from `~/.pi/agent/providers.json`
- **AND** the server broadcasts `{ type: "credentials_updated" }`
- **THEN** the bridge SHALL call `pi.unregisterProvider(name)` for the removed entry
- **AND** that provider's models SHALL NOT appear in `modelRegistry.getAvailable()` after refresh

#### Scenario: Existing provider edited in providers.json
- **WHEN** an existing entry's `baseUrl`, `apiKey`, or `api` field changes in `~/.pi/agent/providers.json`
- **AND** the server broadcasts `{ type: "credentials_updated" }`
- **THEN** the bridge SHALL call `pi.unregisterProvider(name)` then `pi.registerProvider(name, ...)` with the new configuration
- **AND** async model discovery SHALL use the new `baseUrl` / `apiKey`

#### Scenario: Async model discovery completes after registration
- **WHEN** `pi.registerProvider(...)` is called during hot-reload
- **AND** the provider's async `/v1/models` discovery completes
- **THEN** the existing `onProviderChanged` callback SHALL fire
- **AND** the bridge SHALL send an updated `models_list` message for the current session so the dashboard browser client refreshes its model selector

#### Scenario: providers.json unchanged between credentials_updated events
- **WHEN** `credentials_updated` is received
- **AND** `~/.pi/agent/providers.json` has not changed since the last hot-reload
- **THEN** the bridge SHALL NOT call `pi.registerProvider` or `pi.unregisterProvider` for any entry
- **AND** `modelRegistry.refresh()` SHALL still be invoked to handle non-provider credential changes (e.g. OAuth)

#### Scenario: providers.json read fails
- **WHEN** `~/.pi/agent/providers.json` exists but reading or parsing it throws (parse error, IO error)
- **THEN** the bridge SHALL log the error via `console.error` with a `[dashboard]` prefix
- **AND** SHALL keep every currently registered custom provider (no `pi.unregisterProvider` / `pi.registerProvider` call) and report an empty diff
- **AND** SHALL still invoke `modelRegistry.refresh()` so other credential updates are not blocked

#### Scenario: providers.json parses but has no usable providers object
- **WHEN** `~/.pi/agent/providers.json` parses as JSON but its `providers` key is absent, `null`, or not a plain object
- **THEN** the bridge SHALL treat it like a read failure: log, keep every registered custom provider, report an empty diff

#### Scenario: A single malformed provider entry makes the whole file unreadable
- **WHEN** `~/.pi/agent/providers.json` parses but any entry under `providers` is not a plain object (e.g. `{"providers":{"a":null}}`)
- **THEN** the bridge SHALL treat the whole file as unreadable: log, keep every registered custom provider, report an empty diff

#### Scenario: Explicitly empty providers object removes custom providers
- **WHEN** `~/.pi/agent/providers.json` parses and contains `"providers": {}`
- **THEN** the bridge SHALL unregister every previously registered custom provider

#### Scenario: Missing providers.json removes custom providers
- **WHEN** `~/.pi/agent/providers.json` does not exist
- **THEN** the bridge SHALL unregister every previously registered custom provider

#### Scenario: Recovered providers.json applies normally
- **GIVEN** a previous re-sync saw an unreadable file and kept custom provider `keep`
- **WHEN** `~/.pi/agent/providers.json` is now valid and omits `keep`, and a re-sync runs
- **THEN** the bridge SHALL unregister `keep`
