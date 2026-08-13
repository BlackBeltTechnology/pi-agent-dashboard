## ADDED Requirements

### Requirement: Model selector trigger is openable with an empty catalogue

The model selector trigger SHALL be openable when the model list is empty (`models.length === 0`). It SHALL NOT be rendered `disabled` in that state, and clicking it SHALL open the popover the same way it does with a populated list. The chevron affordance SHALL be shown so the control reads as interactive.

Design mockup: `mockups/empty-model-selector.html` (state "Today (bug)" is the pre-change dead button; state 1 is the fixed openable trigger).

#### Scenario: Empty catalogue opens the popover

- **WHEN** the selector is rendered with `models: []` and the user clicks the trigger
- **THEN** the popover SHALL open
- **AND** the trigger SHALL NOT be `disabled`

#### Scenario: Populated catalogue is unchanged

- **WHEN** the selector is rendered with a non-empty `models` list
- **THEN** the trigger SHALL open and behave exactly as before this change

### Requirement: Open triggers a refresh in the empty case

Opening the selector with an empty catalogue SHALL fire the same open-transition `request_models` reload defined by `reload-models-on-selector-open`, exactly once per closed→open transition (not per render). This makes the operator's first click the recovery action: a provider configured after session start is picked up without restarting the session.

While the open-triggered refresh is in flight the popover SHALL show a transient "refreshing" body, not a recovery link.

#### Scenario: Opening an empty selector requests a fresh list

- **WHEN** the selector is opened with `models: []` and an `onRefresh` handler is wired
- **THEN** exactly one `request_models` SHALL be sent on the open transition
- **AND** the popover SHALL show the refreshing body until a `models_list` for the session arrives

#### Scenario: No handler does not error

- **WHEN** the empty selector is opened without an `onRefresh` handler
- **THEN** no `request_models` SHALL be sent
- **AND** the popover SHALL open showing the empty state without throwing

### Requirement: Recovery link when genuinely empty

After an open-triggered refresh has completed and the list is still empty, the empty-state body SHALL render a recovery link labelled `Open provider settings` with a settings (gear) icon and no directional arrow. Activating it SHALL navigate to the dashboard's Settings → Providers surface.

The link SHALL NOT be rendered while the selector is still awaiting the first `models_list` after opening (the `awaitingRefresh` window). "Refresh completed and still empty" is defined as: a `models_list` for the selected session has arrived since the open-triggered `request_models`, and its `models` array is empty. This prevents a premature "no models" affordance during a normal in-flight refresh.

Design mockup: `mockups/empty-model-selector.html` state 2 ("genuinely empty"); decision D4-A in `mockups/selector-decisions.html`.

#### Scenario: Link appears only after a post-open empty result

- **WHEN** the selector was opened (open-triggered `request_models` sent) and no `models_list` has yet arrived
- **THEN** the empty state SHALL show the refreshing body and SHALL NOT show the recovery link
- **WHEN** a `models_list` for the session then arrives with an empty `models` array
- **THEN** the empty state SHALL show the `Open provider settings` link

#### Scenario: Link navigates to provider settings

- **WHEN** the user activates the `Open provider settings` link
- **THEN** the dashboard SHALL open the Settings → Providers surface

### Requirement: Empty-and-errored state uses reopen-to-retry

When the post-refresh empty state coincides with one or more `refreshErrors`, the empty state SHALL present the same `Providers` recovery link (gear icon, no arrow) and SHALL NOT render an inline "Retry" control. Retrying a refresh is performed by closing and reopening the selector, keeping the open transition the single refresh trigger (consistent with the removal of the manual ↻ control).

Design mockup: `mockups/empty-model-selector.html` state 3; decision D5-B.

#### Scenario: Empty + error shows no inline Retry

- **WHEN** a post-open `models_list` arrives empty and carries `refreshErrors`
- **THEN** the empty state SHALL show the `Providers` link
- **AND** SHALL NOT render an inline Retry control
- **WHEN** the user closes and reopens the selector
- **THEN** a new open-triggered `request_models` SHALL be sent

## MODIFIED Requirements

### Requirement: Model dropdown surfaces provider refresh failures

When the `models_list` for the selected session reports that one or more providers failed to refresh **and the resulting list is non-empty**, the model selector dropdown SHALL render a single non-blocking footer line stating a count of unavailable providers (e.g. "1 provider unavailable") together with a `Providers` link (gear icon, no arrow) to Settings → Providers. The footer SHALL NOT name individual providers and SHALL NOT restate the per-provider messages; per-provider names and verbatim error text live in Settings → Providers (see `surface-provider-health-in-settings`). The notice SHALL NOT prevent selecting any model in the list.

When no provider failure is reported, the footer SHALL render no notice — a clean refresh SHALL be silent.

The notice SHALL NOT be presented as a toast or other transient global alert, because the refresh fires on every dropdown open and a persistently failing provider would otherwise alert repeatedly.

Design mockup: `mockups/empty-model-selector.html` state 4 ("partial failure"); decision D1-B.

#### Scenario: One provider fails to refresh

- **WHEN** the dropdown is open, the list is non-empty, and the session's `models_list` reports a refresh failure for a provider
- **THEN** the footer SHALL show a count of unavailable providers and a `Providers` link
- **AND** the footer SHALL NOT name the provider
- **AND** the models already in the list SHALL remain selectable

#### Scenario: Several providers fail to refresh

- **WHEN** the session's `models_list` reports refresh failures for more than one provider and the list is non-empty
- **THEN** the footer SHALL show the total count of unavailable providers (not individual names)

#### Scenario: Clean refresh is silent

- **WHEN** the session's `models_list` reports no refresh failure
- **THEN** the footer SHALL render no refresh notice

#### Scenario: Failure is not raised as a toast

- **WHEN** a refresh failure is reported
- **THEN** no toast or global alert SHALL be raised for it
