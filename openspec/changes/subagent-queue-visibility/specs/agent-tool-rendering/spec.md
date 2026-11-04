# Spec Delta

## ADDED Requirements

### Requirement: Claim-provided row status

A `tool-renderer` claim MAY declare a `rowStatus` predicate returning nothing or `{ state: "queued" | "stopped", label? }`. `queued` SHALL apply only to a running row (a waiting glyph and the label replace the spinner and elapsed time). `stopped` SHALL apply only to a non-error terminal row (a neutral stop glyph replaces the check). Error and elided rows SHALL NOT be overridden. No tool name is hard-coded. If the predicate is absent, returns nothing or throws, the row renders as before.

#### Scenario: Claim reports queued
- **WHEN** a running row's claim `rowStatus` returns `{ state: "queued", label: "queued · #2" }`
- **THEN** the row shows a static waiting glyph and `queued · #2`, and no spinner

#### Scenario: Claim reports stopped on a completed row
- **WHEN** a non-error terminal row's claim `rowStatus` returns `{ state: "stopped" }`
- **THEN** the row shows a neutral stop glyph instead of the success check

#### Scenario: Error row ignores rowStatus
- **WHEN** the row ended with an error and `rowStatus` returns `{ state: "stopped" }`
- **THEN** the row keeps its error presentation

#### Scenario: Predicate throws
- **WHEN** a claim's `rowStatus` throws
- **THEN** the row renders as before this change, and the error is logged once with the plugin id

### Requirement: Claim-owned per-row stop

A `tool-renderer` claim MAY declare a `stop` handler (session id, tool call id, tool details) and a `stopLabel`. On a running row's stop, `ToolCallStep` SHALL call `stop` before its own abort and before any enclosing burst-group controller. If it returns `true`, nothing else SHALL be sent. If it is absent, returns anything else, or throws, the existing stop path SHALL run. A string from `stopLabel` SHALL be the control's accessible label.

#### Scenario: Claim handles the stop
- **WHEN** the user stops a running row whose claim `stop` returns `true`
- **THEN** no session-wide abort is sent

#### Scenario: Claim declines
- **WHEN** the claim `stop` returns `false`
- **THEN** the row sends the session-wide abort, as before this change

#### Scenario: Row inside a burst group
- **WHEN** the row is inside a tool burst group with a shared stop controller and its claim `stop` returns `true`
- **THEN** the shared controller is not triggered by that row
- **AND** the burst group's own stop still aborts the whole turn
