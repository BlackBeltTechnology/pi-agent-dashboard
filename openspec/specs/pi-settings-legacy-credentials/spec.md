# pi-settings-legacy-credentials Specification

## Purpose
Find plain-text API keys left in pi's global settings.json and let the user move them into pi's credential store (`auth.json`) or delete them, without ever exposing or losing a key.

## Requirements

### Requirement: Legacy credential keys are reported masked
The settings read response SHALL list every legacy credential key present in pi's global settings.json: `anthropicApiKey` (provider `anthropic`), `openaiApiKey` (provider `openai`), `providers.<id>.apiKey` (provider `<id>`), and a top-level `apiKey` (no provider). Only non-empty string values count. The `apiKeys` object is not listed, because pi migrates it into `auth.json` itself at startup.

The provider SHALL be normalised the way Settings → Providers stores it: an `<id>-api` suffix resolves to its auth.json key, and a provider id that pi has renamed (for example `azure-openai-responses` → `azure`) maps to its current id.

Each entry SHALL carry:
- the key path;
- the normalised provider, or none;
- the auth state for that provider: `none` (no auth.json credential under the normalised id or its pre-rename id), `same` (an API-key credential with exactly this value, compared server-side), or `different` (an OAuth login, a different API key, or an auth.json that cannot be read reliably). `same` SHALL only be reported after a successful read confirms the exact value;
- a masked value. A value of 32 or more characters SHALL be masked as an ellipsis followed by its last 4 characters; a shorter value SHALL be fully masked.

No legacy-list entry, move/remove response, log line, or error message SHALL contain an unmasked value. The raw file text returned for JSON mode is the file as stored and is not affected by this requirement. Form mode SHALL NOT render legacy credential keys as editable fields.

#### Scenario: Keys are listed masked
- **GIVEN** settings.json contains `anthropicApiKey: "sk-ant-api03-abcdefghijklmnopa3F9"`
- **WHEN** a client reads the settings
- **THEN** the legacy list SHALL contain `anthropicApiKey` with provider `anthropic` and masked value `…a3F9`
- **AND** the legacy entry SHALL NOT contain the full key

#### Scenario: Short value is fully masked
- **GIVEN** settings.json contains `openaiApiKey: "sk-proj-short-key-1234567"`
- **WHEN** a client reads the settings
- **THEN** the masked value SHALL contain none of the key's characters

#### Scenario: Empty values are ignored
- **GIVEN** settings.json contains `openaiApiKey: ""`
- **WHEN** a client reads the settings
- **THEN** the legacy list SHALL NOT contain `openaiApiKey`

#### Scenario: Matching auth.json credential is reported as same
- **GIVEN** settings.json contains `anthropicApiKey` and auth.json holds an `anthropic` API-key credential with the same value
- **WHEN** a client reads the settings
- **THEN** the `anthropicApiKey` entry SHALL report auth state `same`

#### Scenario: OAuth login is reported as different
- **GIVEN** settings.json contains `anthropicApiKey` and auth.json holds an `anthropic` OAuth login
- **WHEN** a client reads the settings
- **THEN** the `anthropicApiKey` entry SHALL report auth state `different`

#### Scenario: Renamed provider id is normalised
- **GIVEN** settings.json contains `providers.azure-openai-responses.apiKey`
- **WHEN** a client reads the settings
- **THEN** the entry's provider SHALL be `azure`

### Requirement: Settings parse errors never quote file content
When pi's settings.json cannot be parsed, every `parseError` or raw-validation message the dashboard returns or logs SHALL describe only the failure position (line and column) and a fixed reason. It SHALL NOT include any text from the file.

#### Scenario: Truncated file holding a key
- **GIVEN** settings.json contains `{"anthropicApiKey": "sk-ant-secret-value` (truncated)
- **WHEN** a client reads the settings
- **THEN** the `parseError` SHALL NOT contain `sk-ant`

### Requirement: Move a legacy key into auth.json
The dashboard SHALL accept a request to move one or more legacy keys that have a provider. The request carries key paths and the settings token, never key values.

For each moved key, the dashboard SHALL store the value in `auth.json` as an API-key credential for the normalised provider. The existence check and the write SHALL happen under one auth.json lock acquisition, so a credential saved concurrently through Settings → Providers is never overwritten. Only after every move's auth.json write has succeeded SHALL the dashboard delete the keys from settings.json.

A move SHALL be refused with `400`, writing nothing, when:
- the key's provider auth state is not `none`;
- the key has no provider;
- the key is not present;
- two actions in the request resolve to the same provider.

The settings token SHALL be checked before any write, and again when settings.json is written. A stale token at the first check SHALL return `409` with nothing written. A stale token at the second check SHALL return `409` without deleting any key. Any change to settings.json, including to a planned key's value, makes the token stale. auth.json writes that already succeeded stay, and a fresh read then reports each such key as `same` (value unchanged) or `different` (value changed meanwhile, so Remove is not offered). Every `409` or `400` response from this request SHALL include the refreshed legacy list.

The new route SHALL sit behind the same network guard as the other pi settings routes.

When removing `providers.<id>.apiKey` leaves `providers.<id>` empty, the empty object SHALL be removed, and an empty `providers` object SHALL be removed as well. A successful request SHALL reload running sessions like any other settings write.

#### Scenario: Move writes auth.json then deletes from settings.json
- **GIVEN** settings.json contains `openaiApiKey` and auth.json has no `openai` credential
- **WHEN** a client moves `openaiApiKey` with the current token
- **THEN** auth.json SHALL contain `openai: { type: "api_key", key: <the value> }`
- **AND** settings.json SHALL NOT contain `openaiApiKey`
- **AND** every other settings.json key SHALL be unchanged

#### Scenario: auth.json failure keeps the key in settings.json
- **GIVEN** the auth.json write fails
- **WHEN** a client moves `openaiApiKey`
- **THEN** the request SHALL fail
- **AND** settings.json SHALL still contain `openaiApiKey`

#### Scenario: Move refused when a credential exists
- **GIVEN** auth.json already holds an `anthropic` credential
- **WHEN** a client moves `anthropicApiKey`
- **THEN** the response SHALL be `400` and neither file SHALL change

#### Scenario: Concurrent Providers save is not overwritten
- **GIVEN** a move of `openaiApiKey` has passed its token check
- **WHEN** an `openai` credential is saved through Settings → Providers before the move's auth.json write
- **THEN** the response SHALL be `409`
- **AND** auth.json SHALL keep the Providers credential
- **AND** settings.json SHALL still contain `openaiApiKey`

#### Scenario: Stale token writes nothing
- **WHEN** a client moves a key with a token that no longer matches settings.json
- **THEN** the response SHALL be `409`
- **AND** neither auth.json nor settings.json SHALL change

#### Scenario: Value changed between write and delete
- **GIVEN** a move of `openaiApiKey` wrote value `v1` to auth.json
- **WHEN** settings.json's `openaiApiKey` is changed to `v2` before the delete phase
- **THEN** settings.json SHALL still contain `openaiApiKey: v2`
- **AND** a fresh read SHALL report auth state `different`

#### Scenario: Two keys for one provider are refused
- **WHEN** a client moves `anthropicApiKey` and `providers.anthropic.apiKey` in one request
- **THEN** the response SHALL be `400` and neither file SHALL change

#### Scenario: Providerless key cannot be moved
- **GIVEN** settings.json contains a top-level `apiKey`
- **WHEN** a client moves `apiKey`
- **THEN** the response SHALL be `400` and neither file SHALL change

#### Scenario: Empty provider block is cleaned up
- **GIVEN** settings.json contains `providers: { zai: { apiKey: "k-1234567890abcdefghij" } }` and nothing else under `providers`
- **WHEN** a client moves `providers.zai.apiKey`
- **THEN** settings.json SHALL NOT contain `providers`

### Requirement: Remove a legacy key
The dashboard SHALL accept a request to remove one or more legacy keys from settings.json without writing `auth.json`, under the settings lock and token. A remove SHALL be refused with `400`, writing nothing, unless the key's auth state is `same`, meaning auth.json holds this exact value. A providerless key, or a key whose stored credential differs, therefore cannot be removed through this request, which prevents deleting the only copy of a credential.

#### Scenario: Remove deletes only the key
- **GIVEN** settings.json contains `anthropicApiKey` and `theme: "dark"`, and auth.json holds an `anthropic` API-key credential with the same value
- **WHEN** a client removes `anthropicApiKey` with the current token
- **THEN** settings.json SHALL contain `theme: "dark"` and SHALL NOT contain `anthropicApiKey`
- **AND** auth.json SHALL be unchanged

#### Scenario: Remove refused without a matching credential
- **GIVEN** auth.json holds no `openai` credential, or holds a different `openai` key
- **WHEN** a client removes `openaiApiKey`
- **THEN** the response SHALL be `400` and settings.json SHALL be unchanged

### Requirement: Legacy key cleanup in the settings page
When the legacy list is non-empty, the pi settings page SHALL show a warning naming each key with its masked value. The action offered depends on the key:
- auth state `same` offers "Remove from settings.json";
- auth state `none` offers "Move to Providers";
- auth state `different`, or a providerless key, offers no action and explains the manual step: keep the credential you want in Providers, then delete the key by hand in JSON mode.

Actions are available in Form mode only. In JSON mode the warning SHALL say the cleanup runs from Form mode, because a raw save would write the keys back.

Choosing an action SHALL queue it, mark the page dirty, and allow undo until Save. Discarding the draft, including when switching mode, also discards the queued actions. After any cleanup response, queued actions SHALL be reconciled with the returned legacy list: an action whose key is gone, or whose key's state no longer allows it, is dropped. The unified Save SHALL run the queued actions and then any form patch, using the token each step returns. If the cleanup fails, the form patch SHALL NOT be sent and the draft SHALL stay dirty. If the cleanup succeeds and the form patch then fails, the page SHALL adopt the state returned by the cleanup, clear the applied actions from the queue, and keep only the form draft dirty. The warning SHALL disappear once no legacy keys remain.

#### Scenario: Queued action applies on Save
- **GIVEN** the warning lists `openaiApiKey` with "Move to Providers"
- **WHEN** the user chooses "Move to Providers" and presses Save
- **THEN** the move request SHALL be sent
- **AND** after success the warning SHALL no longer list `openaiApiKey`

#### Scenario: Undo before Save sends nothing
- **WHEN** the user chooses "Move to Providers" and then Undo
- **THEN** the page SHALL not be dirty because of the cleanup
- **AND** Save SHALL send no move request

#### Scenario: Patch failure after a successful cleanup
- **GIVEN** a move is queued and a form field is changed
- **WHEN** Save runs, the move succeeds, and the form patch returns `400`
- **THEN** the move SHALL NOT be queued again
- **AND** the form draft SHALL stay dirty with its field errors

#### Scenario: JSON mode disables cleanup actions
- **WHEN** the page is in JSON mode and the legacy list is non-empty
- **THEN** the warning SHALL offer no Move or Remove action
