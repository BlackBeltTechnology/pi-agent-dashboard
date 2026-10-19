## Purpose

One status pill, one notice and one inline action error for every dashboard surface, core and plugin, so state and failure read the same everywhere and stay token-sourced in every theme palette.

## ADDED Requirements

### Requirement: One status pill shows tone, icon and a human word

The dashboard SHALL render every status pill through one shared implementation, the `ui:status-pill` primitive. A pill SHALL:

- show one of five tones: success, info, warning, error or neutral;
- take its background, text and border colours from the matching severity tokens;
- show an icon and a human-readable word. A raw state code SHALL NOT be the visible word.

When the caller supplies no icon, the pill SHALL show the tone's default icon. An in-progress state SHALL show a spinning progress icon that stops under `prefers-reduced-motion`. The raw state SHALL stay available as a data attribute. Pill text SHALL be at least 12 px and SHALL meet 4.5:1 contrast against the pill's own fill in base dark, base light and every other built-in palette.

#### Scenario: State readable without colour
- **WHEN** pills in each of the five tones render and are viewed in greyscale
- **THEN** each pill SHALL still be identifiable by its icon and word

#### Scenario: Palette change recolours without reload
- **WHEN** the user switches from base dark to nord dark while a warning pill is visible
- **THEN** the pill SHALL take nord's warning colours without a re-render triggered by script
- **AND** its text SHALL measure at least 4.5:1 against its fill

#### Scenario: Existing state names map to tones
- **WHEN** a plugin renders `ui:status-pill` with state `running`, `success`, `info`, `warn`, `error` or `muted`
- **THEN** the pill SHALL use the info, success, info, warning, error or neutral tone respectively
- **AND** `running` SHALL show the spinning progress icon

#### Scenario: Raw code stays out of the visible text
- **WHEN** a surface shows the state `waiting_peers`
- **THEN** the visible word SHALL be a human phrase such as "Waiting for peers"
- **AND** `waiting_peers` SHALL be available only as an attribute value

### Requirement: One notice anatomy for callouts and banners

The dashboard SHALL render notices, callouts and banners through one shared implementation, provided to plugins as the `ui:notice` primitive. A notice SHALL contain, in order:

- a tone icon;
- a one-line title saying what happened;
- an optional one-sentence explanation;
- optional remedy rows, each an icon plus a sentence;
- optional actions, of which at most one is a primary action;
- optional raw technical detail.

The raw detail SHALL render only inside a disclosure that starts closed, with a "Copy details" control. Error notices SHALL announce as alerts, and other tones as status. Body text SHALL be at least 14 px, line length SHALL be capped at about 72 characters, and colours SHALL come from the severity tokens.

#### Scenario: Raw error hidden behind a disclosure
- **WHEN** a plugin fails to load and its error notice renders with a stack trace as detail
- **THEN** the notice SHALL show a sentence title and a "Try again" action
- **AND** the stack trace SHALL be visible only after opening "Technical details"
- **AND** "Copy details" SHALL copy the stack trace

#### Scenario: Error notice is announced
- **WHEN** an error notice appears
- **THEN** it SHALL be exposed with the alert role
- **AND** an info, warning or success notice SHALL be exposed with the status role

### Requirement: Inline action errors appear at the control that failed

When an action the user can retry in place fails, the dashboard SHALL report it directly under the control or row that triggered it, through one shared implementation provided to plugins as the `ui:action-error` primitive. It SHALL NOT report the failure only as a toast. The message SHALL be one plain sentence. Server codes and raw error text SHALL be reachable only through a "Copy details" control. The message SHALL be linked to the control for assistive technology and SHALL announce as an alert.

#### Scenario: Failed stop reported beside its button
- **WHEN** the user clicks Stop on a service and the server refuses
- **THEN** a one-sentence error SHALL appear directly under that service's Stop control
- **AND** the server's error code SHALL NOT appear in the visible sentence
- **AND** "Copy details" SHALL copy the code and the server message

#### Scenario: One row of many fails
- **WHEN** one of several browser profiles fails to connect
- **THEN** the error SHALL appear inside that profile's row only

### Requirement: Shared status parts are available to plugins

The primitive registry SHALL provide the status pill, the notice and the inline action error to plugins. A plugin SHALL be able to render all three without importing host packages directly. The plugin settings field kit SHALL render its status pill and notice through these primitives and SHALL NOT keep a colour map of its own.

#### Scenario: Plugin renders a notice through the registry
- **WHEN** a plugin requests the notice primitive from the registry
- **THEN** it SHALL receive the host's notice component
- **AND** the rendered notice SHALL match a core notice of the same tone
