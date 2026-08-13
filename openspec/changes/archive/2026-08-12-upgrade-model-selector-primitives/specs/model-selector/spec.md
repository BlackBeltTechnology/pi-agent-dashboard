## REMOVED Requirements

### Requirement: User-initiated model list refresh

**Reason**: The requirement's premise — a manual refresh control in the dropdown footer, with a busy indicator and a safety timeout — is deleted. The control fired the same `request_models` the open transition already sends microseconds earlier, so it offered no capability of its own, while its busy indicator taught users the list might be stale when it had just been refreshed. The `refreshing` state, the `models`-identity clear effect, and the 10 s safety-timeout effect existed only to service that indicator and are removed with it. The surviving behaviour (refresh on open, optional handler) is restated by the ADDED requirement "Model list refresh on dropdown open", whose trigger is the open transition rather than a user-activated control — so the requirement is replaced rather than modified. The vacated footer slot now carries provider refresh failures.

**Migration**: No user action. The `model-refresh` test id and the `common.refreshModels` / `common.refreshingModels` i18n keys (plus their `auto.refresh_models` / `auto.refreshing_models` legacy aliases) are retired. `onRefresh` remains an optional prop with unchanged signature; hosts that pass it keep refreshing, now on open instead of on click. Hosts that pass no handler are unaffected.

## ADDED Requirements

### Requirement: Model list refresh on dropdown open

Opening the model selector dropdown SHALL re-request the available model list for the currently selected session. The open transition SHALL send a `request_models` message scoped to the selected session, deliberately bypassing the client's "fetch once per session" guard (`!modelsMap.has(sessionId)`), so a live session pulls a fresh list every time the user goes looking for a model. The resulting `models_list` push SHALL update the dropdown through the existing per-session update path.

Opening the dropdown SHALL be the only refresh trigger. The dropdown SHALL NOT render a separate manual refresh control in its footer: it duplicated the open-transition request without offering any capability the open transition does not already provide, and its busy indicator implied the list was otherwise stale.

The refresh capability SHALL remain optional on the selector; when the host provides no refresh handler (e.g. no session selected) opening the dropdown SHALL simply render the last-known list without requesting an update.

#### Scenario: Opening the dropdown refreshes a stale list

- **WHEN** a session is live and the user opens the model dropdown
- **THEN** the client sends `request_models` for the selected session
- **AND** on receipt of the `models_list` for that session the dropdown shows the updated models

#### Scenario: Refresh bypasses the fetch-once guard

- **WHEN** the selected session already has an entry in `modelsMap`
- **AND** the user opens the model dropdown
- **THEN** the client still sends `request_models` for that session (the `!modelsMap.has(sessionId)` guard does not suppress the open-transition request)

#### Scenario: No manual refresh control is rendered

- **WHEN** the user opens the model dropdown
- **THEN** the dropdown SHALL NOT present a manual refresh button
- **AND** the dropdown SHALL NOT present a refresh busy indicator

#### Scenario: No request without a handler

- **WHEN** the selector is opened and the host provided no refresh handler
- **THEN** no `request_models` message SHALL be sent
- **AND** the dropdown SHALL render the last-known list

### Requirement: Model dropdown surfaces provider refresh failures

When the `models_list` for the selected session reports that one or more providers failed to refresh, the model selector dropdown SHALL render a non-blocking notice in its footer naming each failing provider and stating that the last-known list is being shown. The notice SHALL NOT prevent selecting any model in the list.

When no provider failure is reported, the footer SHALL render no notice — a clean refresh SHALL be silent.

The notice SHALL NOT be presented as a toast or other transient global alert, because the refresh fires on every dropdown open and a persistently failing provider would otherwise alert repeatedly.

#### Scenario: One provider fails to refresh

- **WHEN** the dropdown is open and the session's `models_list` reports a refresh failure for a provider
- **THEN** the footer SHALL name that provider
- **AND** the footer SHALL indicate that the displayed list is the last-known one
- **AND** the models already in the list SHALL remain selectable

#### Scenario: Several providers fail to refresh

- **WHEN** the session's `models_list` reports refresh failures for more than one provider
- **THEN** the footer SHALL name every reported provider, not only the first

#### Scenario: Clean refresh is silent

- **WHEN** the session's `models_list` reports no refresh failure
- **THEN** the footer SHALL render no refresh notice

#### Scenario: Failure is not raised as a toast

- **WHEN** a refresh failure is reported
- **THEN** no toast or global alert SHALL be raised for it
