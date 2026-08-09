## ADDED Requirements

### Requirement: Per-session pipeline is contributed through the existing `session-card-memory` slot

The plugin SHALL contribute its per-session surface as a `session-card-memory` claim and SHALL NOT introduce a new slot or modify existing slot definitions.

#### Scenario: Contribution renders inside the MEMORY subcard

- **WHEN** the `blackhole` plugin is active and claims `session-card-memory`
- **THEN** the MEMORY subcard SHALL render on session cards
- **AND** the plugin's component SHALL receive `{ session, pluginContext }`

#### Scenario: No shared slot definitions change

- **WHEN** the repo-lint test inspects the change's diff
- **THEN** `packages/shared/src/dashboard-plugin/slot-types.ts` and `slot-props.ts` SHALL be unmodified

#### Scenario: Subcard is absent when the extension is missing

- **WHEN** `pi-blackhole` is not installed
- **THEN** the claim's `shouldRender` SHALL return `false`
- **AND** the claim SHALL NOT be mounted, so `useSlotHasClaimsForSession` counts it absent and the MEMORY subcard does not render
- **AND** this SHALL NOT depend on the host filtering claims by `missingRequirements`, which it does not do

#### Scenario: The gate is synchronous and fails closed

- **WHEN** the plugin has not yet published its detection result for the session
- **THEN** `shouldRender` SHALL return `false`
- **AND** SHALL return synchronously without awaiting a probe

#### Scenario: Detection is a global installed-check, resolved once

- **WHEN** the gate determines whether the extension is present
- **THEN** it SHALL read a module-level value resolved once from the plugin's own server route
- **AND** that route SHALL determine presence from the existence of blackhole's directory or config file
- **AND** detection SHALL NOT depend on any command name, whose registration form is unverifiable
- **AND** SHALL NOT depend on the host's `missingRequirements`, which is not exposed to plugins
- **AND** SHALL NOT publish session data, which no plugin does and which would not re-render the gate
- **AND** SHALL NOT require any change to an existing dashboard package

#### Scenario: The check runs without a mount point

- **WHEN** the dashboard client boots
- **THEN** the plugin's client entry SHALL perform the check at module scope
- **AND** SHALL NOT require a slot, a mounted component, or polling

#### Scenario: A session that never loaded the extension shows the empty state, not a hidden subcard

- **WHEN** blackhole is installed but a given session never loaded it
- **THEN** the subcard SHALL render its no-activity-yet state for that session
- **AND** SHALL NOT assert that the pipeline is running

> Note: per-session capability data reaches the browser only for the subscribed session, so a per-session gate is not deliverable without a host change. The global gate prevents the regression it exists to prevent; the residual imprecision is recorded as an accepted trade-off.

#### Scenario: The gate is declared as an exported function name

- **WHEN** the manifest declares `shouldRender` for the claim
- **THEN** the value SHALL be a string naming an exported client function

#### Scenario: Non-users see no new session-card chrome

- **WHEN** a user without `pi-blackhole` views any session card
- **THEN** no MEMORY subcard SHALL appear on any card as a result of this plugin

### Requirement: The per-session endpoint returns the global fields the subcard needs

The subcard's states depend on global configuration as well as per-session state, so the per-session endpoint SHALL return both in one response. The client SHALL NOT read the global config file directly, and the settings surface remains the only writer.

#### Scenario: Response carries the proximity denominator and mode fields

- **WHEN** the per-session endpoint is queried
- **THEN** the response SHALL include `compactAfterTokens`, `memory`, and `compaction` from the global config
- **AND** SHALL include resolved-model and cooldown information derived from `pi-blackhole-cooldown.json`

#### Scenario: The session surface performs no writes

- **WHEN** the subcard renders in any state
- **THEN** no write SHALL be issued to any blackhole file

### Requirement: Per-session state is joined by the dashboard session id

The server SHALL read per-session state from `<agentDir>/pi-blackhole/<session.id>-pending.json`, using the dashboard session's `id` verbatim.

#### Scenario: File resolved from the session id

- **WHEN** a request is made for session `019fe770-a0a4-70bb-ac85-2e92e6aa8216`
- **THEN** the server SHALL read `<agentDir>/pi-blackhole/019fe770-a0a4-70bb-ac85-2e92e6aa8216-pending.json`

#### Scenario: Session id is validated before filesystem access

- **WHEN** the route receives an `id` that does not match RFC 4122 UUID syntax
- **THEN** the server SHALL reject the request
- **AND** SHALL NOT perform any filesystem operation

#### Scenario: Validation accepts every UUID version pi emits

- **WHEN** the route receives a UUIDv7 id such as `019fe770-a0a4-70bb-ac85-2e92e6aa8216`
- **THEN** the server SHALL accept it
- **AND** validation SHALL NOT restrict the version nibble to versions 1–5, which would reject every session id pi currently produces

#### Scenario: Traversal attempt is rejected

- **WHEN** the route receives an `id` containing a path separator or `..`
- **THEN** the server SHALL reject the request without touching the filesystem

#### Scenario: Resolved path is confined to the blackhole directory

- **WHEN** the filename has been built from a validated id
- **THEN** the resolved absolute path SHALL be asserted to lie inside `<agentDir>/pi-blackhole/` before any read

### Requirement: Absent per-session state is a normal state

A missing per-session file SHALL be reported as "no pipeline activity yet" rather than an error, because the file is created only after a worker first runs.

#### Scenario: File absent

- **WHEN** no `<session.id>-pending.json` exists and `memory` is enabled
- **THEN** the response SHALL indicate no recorded activity
- **AND** the subcard SHALL render a no-activity-yet state distinct from workers-off and from not-installed

#### Scenario: Torn or malformed per-session file degrades quietly

- **WHEN** the per-session file exists but cannot be parsed
- **THEN** the response SHALL be treated as no recorded activity
- **AND** the subcard SHALL NOT render a parse error on the session card

### Requirement: Subcard shows worker health and pipeline lag

The subcard SHALL render one indicator per worker — observer, reflector, dropper — and the exact cursor lag read from the per-session file.

#### Scenario: Healthy state is one row

- **WHEN** all three workers resolve to their primary model and no batches are pending
- **THEN** the subcard SHALL render a single row of worker indicators plus the lag and proximity readouts
- **AND** SHALL NOT render an advisory note

#### Scenario: Worker state is not conveyed by colour alone

- **WHEN** any worker indicator renders
- **THEN** it SHALL carry a textual identifier for the worker
- **AND** SHALL expose an accessible name describing that worker's state

#### Scenario: Cursor lag is exact

- **WHEN** the per-session file records an observer cursor at entry `#412` and the branch tip is entry `#450`
- **THEN** the subcard SHALL report a lag of 38 entries
- **AND** that figure SHALL NOT be marked as approximate

### Requirement: Compaction proximity is presented as an explicit approximation

Blackhole's own counter is never persisted, so the subcard SHALL derive compaction proximity from the dashboard's `contextTokens` measured against `compactAfterTokens`, and SHALL present it in a way that cannot be mistaken for blackhole's internal figure.

#### Scenario: Approximation is disclosed in the rendered output

- **WHEN** the proximity meter renders
- **THEN** its visible label SHALL mark the value as approximate
- **AND** an explanation SHALL be reachable stating that blackhole counts a different quantity and that the two are not convertible

#### Scenario: No false precision

- **WHEN** the proximity meter renders
- **THEN** it SHALL NOT display an exact token count or an exact percentage for the proxy value

#### Scenario: The approximation never drives an automatic alarm

- **WHEN** the proxy value crosses any fraction of `compactAfterTokens`
- **THEN** the subcard SHALL NOT automatically raise an alert, change the session's status, or assert that compaction is imminent

#### Scenario: An exact figure is always present alongside

- **WHEN** the proximity meter renders
- **THEN** the exact cursor lag SHALL render in the same subcard
- **AND** the two SHALL be visually distinguishable as approximate and exact respectively

#### Scenario: Proximity is omitted when its inputs are unavailable

- **WHEN** `contextTokens` is unknown for the session, or `compactAfterTokens` cannot be read
- **THEN** the proximity meter SHALL NOT render
- **AND** the subcard SHALL still render worker indicators and cursor lag

#### Scenario: The meter carries no quantitative scale

- **WHEN** the proximity meter renders
- **THEN** it SHALL NOT render numeric threshold marks along its track
- **AND** its fill SHALL NOT be presented as a measured position on a scale, since the underlying quantities are not convertible

> Note: an earlier revision required proportional threshold marks here. Marks assert a quantitative mapping that the approximation explicitly disclaims; the two requirements were contradictory and the marks were removed.

### Requirement: Degraded and pending states are surfaced conditionally

The subcard SHALL render an advisory row only when the pipeline is not in its ordinary healthy state.

#### Scenario: Worker on a fallback model

- **WHEN** a worker's primary model has an active cooldown entry in `pi-blackhole-cooldown.json`
- **THEN** that worker's indicator SHALL render a degraded state
- **AND** an advisory row SHALL name the cooling model and its remaining cooldown

#### Scenario: Unflushed batches in manual mode

- **WHEN** `compaction` is `manual` and the per-session file holds accumulated batches
- **THEN** an advisory row SHALL report the pending batch count and how to flush

#### Scenario: Memory workers disabled

- **WHEN** `memory` is `false`
- **THEN** the subcard SHALL state that workers are off and that compaction still runs
- **AND** SHALL NOT render a progress meter

#### Scenario: Detail view is always reachable

- **WHEN** the subcard renders in any state
- **THEN** an affordance opening the pipeline detail view SHALL be available
- **AND** its presence SHALL NOT depend on the approximate proximity value

### Requirement: The detail view does not displace the chat view unbidden

`content-view` is a `one-active` slot whose contribution replaces the session's chat view, and other plugins already claim it. The blackhole claim SHALL activate only on explicit navigation and SHALL provide a way back.

#### Scenario: Not active by default

- **WHEN** `pi-blackhole` is installed and the user has not navigated to the blackhole detail route
- **THEN** the claim's predicate SHALL return `false`
- **AND** the session's chat view SHALL remain the active content view

#### Scenario: Does not outrank an existing content-view owner on a tie

- **WHEN** another plugin's `content-view` claim is active for the session
- **THEN** the blackhole claim SHALL NOT take the active slot by ordering alone
- **AND** the plugin's manifest-level `priority` SHALL be a HIGHER number than that of first-party plugins claiming the same slot, because the lowest number wins

#### Scenario: Ordering is not declared per claim

- **WHEN** the manifest is inspected
- **THEN** no claim entry SHALL carry a `priority` field, since ordering is manifest-wide and a per-claim value is ignored

#### Scenario: Return path exists

- **WHEN** the detail view is active
- **THEN** an affordance returning to the session's chat view SHALL be present

### Requirement: Detail view shows only data readable at rest, with provenance

The `content-view` detail surface SHALL render per-worker cursors and resolved models, SHALL label each value with its source file, and SHALL NOT render values that exist only in the running session.

#### Scenario: Cursors are shown with provenance

- **WHEN** the detail view renders worker cursors
- **THEN** each SHALL be attributed to the per-session pending file

#### Scenario: Resolved model is shown with its reason

- **WHEN** a worker's primary model is cooling down
- **THEN** the detail view SHALL show the resolved fallback and the reason, attributed to the cooldown file

#### Scenario: In-memory-only values are absent

- **WHEN** the detail view renders
- **THEN** it SHALL NOT display observation counts, reflection counts, `consolidationInFlight`, `compactInFlight`, or last-error strings
- **AND** SHALL state that observations and reflections appear in the session transcript

#### Scenario: Proximity carries its caveat into the detail view

- **WHEN** the detail view displays compaction proximity
- **THEN** it SHALL attribute the value to the dashboard's own token accounting, not to blackhole
- **AND** SHALL state that blackhole's counter measures a different quantity and is not persisted

#### Scenario: Detail view is session-scoped

- **WHEN** the detail view is opened
- **THEN** it SHALL be reached from the session's own surface
- **AND** the global settings page SHALL NOT render per-session pipeline state

### Requirement: Per-session route is read-only

The per-session endpoint SHALL expose no mutating operation; the plugin SHALL NOT write to blackhole's per-session file, trigger compaction, or flush pending batches.

#### Scenario: Only reads are exposed

- **WHEN** the plugin's server routes are enumerated
- **THEN** the per-session path SHALL register a `GET` handler and no `PUT`, `POST`, `PATCH`, or `DELETE` handler

#### Scenario: Per-session file is never written

- **WHEN** any per-session request is served
- **THEN** the modification time and bytes of `<session.id>-pending.json` SHALL be unchanged
