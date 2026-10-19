# shared-status-recipes Specification

## Purpose
One status pill, one notice and one inline action error for every dashboard surface, core and plugin, so state and failure read the same everywhere and stay token-sourced in every theme palette.

## Requirements

### Requirement: One status pill shows tone, icon and a human word

The dashboard SHALL render every status pill through one shared implementation. That implementation is the plugin settings kit's status pill. The `ui:status-pill` primitive SHALL render the same pill. A pill SHALL:

- show one of five tones: success, info, warning, error or neutral;
- take its background, text and border colours from the matching severity tokens;
- show an icon and a human-readable word. A raw state code SHALL NOT be the visible word; it MAY stay available as a data attribute.

When the caller supplies no icon, the pill SHALL show the tone's default icon, present on first paint without waiting for the lazily loaded icon set. When the caller supplies an icon by key and the key has not resolved yet, or is unknown, the pill SHALL show the tone's default icon. An in-progress state SHALL show a spinning progress icon that does not animate under `prefers-reduced-motion`. Pill text SHALL be 11 px, or 12 px inside an interactive element. It SHALL meet 4.5:1 contrast against the pill's own fill in base dark, base light and nord dark, and at least 3:1 in every other named theme.

#### Scenario: State readable without colour
- **WHEN** pills in each of the five tones render and are viewed in greyscale
- **THEN** each pill SHALL still be identifiable by its icon and word

#### Scenario: Palette change recolours without reload
- **WHEN** the user switches from base dark to nord dark while a warning pill is visible
- **THEN** the pill SHALL take nord's warning colours without a re-render triggered by script
- **AND** its text SHALL measure at least 4.5:1 against its fill

#### Scenario: Default icon on a cold load
- **WHEN** the dashboard loads cold and a pill renders before the full icon set has loaded
- **THEN** the pill SHALL already show its tone's default icon

#### Scenario: Progress icon respects reduced motion
- **WHEN** an in-progress pill renders with `prefers-reduced-motion: reduce`
- **THEN** its progress icon SHALL NOT animate

#### Scenario: Raw code stays out of the visible text
- **WHEN** the plugin list shows a plugin whose load failed
- **THEN** the visible word SHALL be a human phrase such as "Failed to load"
- **AND** the raw state (`error`) SHALL be available only as an attribute value

### Requirement: One notice anatomy for callouts and banners

The dashboard SHALL render notices, callouts and banners through one shared implementation: the plugin settings kit's notice. A notice SHALL show a tone icon, then its message (a short title saying what happened, and an optional one-sentence explanation), then optional remedy rows, then an optional action row:

- each remedy row is an icon plus a sentence that may contain a link;
- the action row holds at most one primary action, an optional "Try again", and an optional "Copy details".

Raw technical detail (codes, HTTP status, response bodies, stack traces) SHALL NOT render as visible text; "Copy details" SHALL copy it. A notice that is retrying SHALL expose a busy state (`aria-busy`). Error notices SHALL announce as alerts, and other tones as status. Text SHALL be at least 12 px and colours SHALL come from the severity tokens.

#### Scenario: Raw error kept out of the visible text
- **WHEN** a plugin fails to load and its error notice renders with a stack trace as detail
- **THEN** the notice SHALL show a sentence and a "Try again" action
- **AND** the stack trace SHALL NOT be visible
- **AND** "Copy details" SHALL copy the stack trace

#### Scenario: Retrying notice is busy
- **WHEN** the user chooses "Try again" and the retry is in flight
- **THEN** the notice SHALL expose `aria-busy="true"` and the retry control SHALL be disabled

#### Scenario: Copying fails
- **WHEN** the user chooses "Copy details" and the clipboard is unavailable or rejects
- **THEN** the control SHALL report that copying failed instead of claiming success

#### Scenario: Error notice is announced
- **WHEN** an error notice appears
- **THEN** it SHALL be exposed with the alert role
- **AND** an info, warning or success notice SHALL be exposed with the status role

### Requirement: Inline action errors appear at the control that failed

When an action the user can retry in place fails, the dashboard SHALL report it directly under the control or row that triggered it, through one shared implementation in the plugin settings kit. It SHALL NOT report the failure only as a toast. The message SHALL be one plain sentence. Server codes and raw error text SHALL be reachable only through "Copy details". The message SHALL be linked to the control for assistive technology and SHALL announce as an alert.

#### Scenario: Failed stop reported beside its button
- **WHEN** the user clicks Stop on a service and the server refuses
- **THEN** a one-sentence error SHALL appear directly under that service's Stop control
- **AND** the server's error code SHALL NOT appear in the visible sentence
- **AND** "Copy details" SHALL copy the code and the server message

#### Scenario: One row of many fails
- **WHEN** one of several browser profiles fails to connect
- **THEN** the error SHALL appear inside that profile's row only

### Requirement: Plugins and core share the same parts

Plugins SHALL get the status pill, notice and inline action error by importing them from the plugin settings kit package, as they already do for settings fields. Core surfaces SHALL import the same components. No surface in the listed migration set SHALL keep a private pill, notice or inline-error colour map.

#### Scenario: Core and plugin pills are identical
- **WHEN** the Services page and a plugin settings page each render an error-tone pill with the word "Failed"
- **THEN** both pills SHALL render the same element structure, classes and icon
