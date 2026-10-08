## MODIFIED Requirements

### Requirement: Resize telemetry

When a resize occurs, the extension SHALL emit exactly one info-level diagnostic through the diagnostics sink, in the format `[pi-image-fit] <relativeOrAbsolutePath> <srcW>×<srcH> <srcBytes> → <dstW>×<dstH> <dstBytes>`. No telemetry SHALL be emitted on already-small pass-throughs, on non-image reads, or on non-read tool calls.

#### Scenario: Resize emits one log line

- **WHEN** the extension resizes an image
- **THEN** exactly one info-level diagnostic in the documented format is emitted through the diagnostics sink

#### Scenario: Pass-through emits no log line

- **WHEN** the extension processes a read of an already-small image (no resize)
- **THEN** no diagnostic is emitted

#### Scenario: Failure emits warning, not info

- **WHEN** the extension's defensive fall-through fires
- **THEN** a warning-level diagnostic prefixed `[pi-image-fit] WARN ` is emitted, distinguishable from a resize diagnostic

## ADDED Requirements

### Requirement: Diagnostics sink

All extension output SHALL go through a single diagnostics sink. The sink SHALL NOT write to stdio while the host offers an interactive UI. It SHALL keep console output when the host has no UI.

#### Scenario: Interactive host, info telemetry

- **WHEN** the latest event context has `hasUI === true` and `ui.setStatus` is a function
- **THEN** an info diagnostic is shown via `ui.setStatus("pi-image-fit", message)`
- **AND** `ui.notify` and the console are not used

#### Scenario: Interactive host without setStatus

- **WHEN** the latest event context has `hasUI === true`, `ui.notify` is a function and `ui.setStatus` is not
- **THEN** an info diagnostic is shown via `ui.notify(message, "info")`

#### Scenario: Interactive host, warning

- **WHEN** the latest event context has `hasUI === true` and `ui.notify` is a function
- **THEN** a warning diagnostic is shown via `ui.notify(message, "warning")`
- **AND** the console is not used

#### Scenario: Print/JSON host keeps console

- **WHEN** the event context has `hasUI !== true` (pi's no-op UI context)
- **THEN** info diagnostics go to `console.log` and warnings to `console.warn`
- **AND** the no-op `ui.notify` is not called

#### Scenario: Latest context wins

- **WHEN** a second event context with a UI arrives (reload, new session, fork, switch)
- **THEN** subsequent diagnostics use the second context's UI
- **AND** the first context's UI is not called

#### Scenario: Stale context is ignored

- **WHEN** reading `hasUI` or `ui` on an event context throws
- **THEN** the sink keeps its previous channel and does not throw

#### Scenario: Failing UI channel

- **WHEN** the UI call throws
- **THEN** the diagnostic falls back to the console and the resize is unaffected

#### Scenario: Load-time messages are buffered

- **WHEN** the extension emits a diagnostic during load, before any event context exists
- **THEN** the diagnostic is held, bounded to 50 messages with the oldest dropped first
- **AND** it is delivered, in order, through the channel of the first event context (including `session_start`)

#### Scenario: Disabled extension still reports

- **WHEN** `PI_IMAGE_FIT_DISABLE` is truthy
- **THEN** only a `session_start` handler is registered
- **AND** it delivers the "disabled via PI_IMAGE_FIT_DISABLE" diagnostic through that context's channel

#### Scenario: Quiet mode

- **WHEN** `PI_IMAGE_FIT_QUIET` is `1`, `true`, `yes` or `on` (case-insensitive)
- **THEN** no diagnostic is emitted on any channel
