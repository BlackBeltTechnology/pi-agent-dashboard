# responsive-viewport Specification

## Purpose

Provide a reactive media-query primitive and a mobile-layout context so components can flip between desktop and single-panel mobile layouts. The viewport is treated as "mobile" whenever its width is below 768px OR its height is below 600px, catching landscape phones as well as narrow screens.

## Requirements

### Requirement: Reactive Media Query Tracking

The media-query hook SHALL report whether a given CSS media query currently matches and SHALL update its result whenever the match state changes.

#### Scenario: Initial match state

- **WHEN** a component reads the hook with a CSS media query string
- **THEN** the hook returns true if the query matches the current viewport
- **AND** returns false if it does not match

#### Scenario: Reacting to viewport changes

- **WHEN** the viewport changes such that the query's match state flips
- **THEN** the hook returns the new match value
- **AND** the consuming component re-renders

#### Scenario: Re-subscribing when the query changes

- **WHEN** the query string passed to the hook changes
- **THEN** the hook re-evaluates against the new query
- **AND** stops responding to changes of the previous query

### Requirement: Server and Missing matchMedia Fallback

The media-query hook SHALL return a non-matching (false) result when it runs without a browser environment or without `matchMedia` support, and SHALL not subscribe to any change events in that case.

#### Scenario: No window or no matchMedia

- **WHEN** the hook runs where `window` is undefined or `window.matchMedia` is not a function
- **THEN** the hook returns false
- **AND** no media-query change subscription is created

### Requirement: Mobile Layout Context

The mobile provider SHALL expose an isMobile boolean to its descendants, and the mobile accessor SHALL return true whenever the viewport width is below 768px OR the viewport height is below 600px.

#### Scenario: Narrow width

- **WHEN** the viewport width is at most 767px
- **THEN** isMobile is true

#### Scenario: Short height (landscape phone)

- **WHEN** the viewport height is at most 599px
- **THEN** isMobile is true

#### Scenario: Desktop viewport

- **WHEN** the viewport width is at least 768px AND the viewport height is at least 600px
- **THEN** isMobile is false

#### Scenario: Crossing a breakpoint

- **WHEN** the viewport crosses either the 768px width threshold or the 600px height threshold
- **THEN** isMobile updates to the new value
- **AND** descendants consuming the mobile context re-render
