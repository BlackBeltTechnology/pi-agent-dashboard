## MODIFIED Requirements

### Requirement: Per-session pipeline is contributed through the existing `session-card-memory` slot

The plugin SHALL contribute its per-session surface as a `session-card-memory` claim and SHALL NOT introduce a new slot or modify existing slot definitions.

While the surface is parked (see *The per-session card surface is parked*), the claim SHALL remain declared but SHALL never mount, and the mounting scenarios in this requirement SHALL be read as the contract that governs on restore rather than as live assertions about the running dashboard.

#### Scenario: Contribution renders inside the MEMORY subcard

- **WHEN** the `blackhole` plugin is active, claims `session-card-memory`, and the surface is not parked
- **THEN** the MEMORY subcard SHALL render on session cards
- **AND** the plugin's component SHALL receive `{ session }` as props, with the plugin context available via the runtime's plugin layer (the host does not pass `pluginContext` as a prop)

#### Scenario: No shared slot definitions change

- **WHEN** the repo-lint test inspects the change's diff
- **THEN** `packages/shared/src/dashboard-plugin/slot-types.ts` and `slot-props.ts` SHALL be unmodified

#### Scenario: Subcard is absent when the extension is missing

- **WHEN** neither `pi-blackhole` nor `@blackbelt-technology/pi-dashboard-context-manager` is installed
- **THEN** the claim's `shouldRender` SHALL return `false`
- **AND** the claim SHALL NOT be mounted, so `useSlotHasClaimsForSession` counts it absent and the MEMORY subcard does not render
- **AND** this SHALL NOT depend on the host filtering claims by `missingRequirements`, which it does not do

#### Scenario: The gate is synchronous and fails closed

- **WHEN** the plugin's global detection result has not yet resolved
- **THEN** `shouldRender` SHALL return `false`
- **AND** SHALL return synchronously without awaiting a probe

#### Scenario: Detection is a global installed-check, resolved once

- **WHEN** the gate determines whether the extension is present
- **THEN** it SHALL read a module-level value resolved once from the plugin's own server route
- **AND** when the host provides the `isPiExtensionInstalled` capability, that route SHALL report the registry answer alone, where the extension counts as installed when the registry contains `pi-blackhole` or `@blackbelt-technology/pi-dashboard-context-manager` — a negative registry answer SHALL NOT be overridden by config-file existence, because the config file survives uninstall and means "has run once" rather than "is installed"
- **AND** only when the capability is absent SHALL the route degrade to config-file existence as its fallback signal
- **AND** detection SHALL NOT depend on any command name, whose registration form is unverifiable
- **AND** SHALL NOT depend on the host's `missingRequirements`, which is not exposed to plugins
- **AND** SHALL NOT publish session data, which no plugin does and which would not re-render the gate

#### Scenario: A capability failure is retryable, not a false negative

- **WHEN** the status route's `isPiExtensionInstalled` call rejects
- **THEN** the route SHALL respond with a 5xx status
- **AND** SHALL NOT respond `{ installed: false }`, so the client's retry path treats the failure as transient rather than as an authoritative not-installed answer

#### Scenario: Context-manager fork counts as installed
- **WHEN** the registry contains `@blackbelt-technology/pi-dashboard-context-manager` and not `pi-blackhole`
- **THEN** the status route SHALL respond `200 { installed: true }`

#### Scenario: The check runs without a mount point

- **WHEN** the dashboard client boots
- **THEN** the plugin's client entry SHALL perform the check at module scope
- **AND** SHALL NOT require a slot, a mounted component, or polling

#### Scenario: The boot check does not run under the test environment

- **WHEN** the client entry is imported under vitest/jsdom
- **THEN** the module-scope check SHALL NOT issue a network request
- **AND** the resolve function SHALL remain invokable explicitly with an injected fetch

#### Scenario: A transient failure is not a permanent false negative

- **WHEN** the boot check's request does not produce a well-formed `200 { installed: boolean }` response — network error, any non-200 status (including the 404 of a disabled plugin), or a malformed body
- **THEN** the check SHALL retry with capped backoff and then continue at a slow fixed interval until a request succeeds — it SHALL NOT permanently give up
- **AND** the gate SHALL continue returning `false` until a successful resolve
- **AND** after the first successful resolve, the value SHALL be final for the page lifetime with no further polling

#### Scenario: A late-arriving positive resolve re-evaluates gates for quiet sessions

- **WHEN** the check resolves installed after session cards have already rendered
- **THEN** the plugin SHALL bump the runtime's slot-claims invalidation store
- **AND** the MEMORY subcard SHALL appear on cards of sessions that will never broadcast again, without user interaction, once the surface is no longer parked

#### Scenario: A session that never loaded the extension shows the empty state, not a hidden subcard

- **WHEN** blackhole is installed but a given session never loaded it
- **THEN** the subcard SHALL render its no-activity-yet state for that session
- **AND** SHALL NOT assert that the pipeline is running

> Note: per-session capability data reaches the browser only for the subscribed session, so a per-session gate is not deliverable without a host change. The global gate prevents the regression it exists to prevent; the residual imprecision is recorded as an accepted trade-off.

#### Scenario: The gate is declared as an exported function name

- **WHEN** the manifest declares `shouldRender` for the claim
- **THEN** the value SHALL be a string naming an exported client function

#### Scenario: Non-users see no new session-card chrome

- **WHEN** a user with neither `pi-blackhole` nor `@blackbelt-technology/pi-dashboard-context-manager` installed views any session card
- **THEN** no MEMORY subcard SHALL appear on any card as a result of this plugin
- **AND** while the surface is parked this SHALL hold for every user, installed or not
