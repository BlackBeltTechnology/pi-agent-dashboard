## ADDED Requirements

### Requirement: Lifecycle handlers, event forwarders and inbound dispatch are importable
The bodies of the bridge's pi lifecycle handlers (`session_start`, `turn_end`, `session_shutdown`, `session_info_changed`, `project_trust`), the enriched and pass-through event forwarders, and the inbound WebSocket message dispatch SHALL live in modules that a test can import without loading the bridge entry point. Each SHALL receive the state it reads or writes through one explicit per-incarnation instance object passed by the entry point, which in turn references the process-global bridge state that survives reload; the modules SHALL hold no module-level mutable state. The entry point SHALL keep the process-global state and its cross-reload adoption (session id, attached change, stop-after-turn latch, namer state, connections, timers), the subagent re-entry guard, the generation counter and its bump, `EVENT_BUS_MAP` and the EventBus emit intercept, and the registration wiring; each instance object SHALL carry the generation it was created with and expose `isActive()` derived from it. Extracted modules SHALL NOT import the entry point.

#### Scenario: Handler runs against a stub state without the entry point
- **WHEN** a test imports an extracted handler module and invokes the handler with a stub `pi`, a stub context and a fresh instance object over a fresh process-global state
- **THEN** the handler SHALL execute and mutate only the supplied instance and its referenced global state
- **AND** the test SHALL NOT have imported the bridge entry point

#### Scenario: Replacement instance shares no state with its predecessor
- **WHEN** the extension is reloaded so a newer bridge instance bumps the shared generation and the older instance's `isActive()` becomes false
- **THEN** handlers wired by the older instance SHALL stay inert
- **AND** handlers wired by the newer instance SHALL run, and cross-reload values (session id, attached change, stop-after-turn latch) SHALL be the adopted ones, not fresh defaults

#### Scenario: Inbound message reaches the same branch as before
- **WHEN** the dashboard sends any of the inbound message types the bridge accepted before this change (`credentials_updated`, `preferences_update`, `flow_management`, `edit_followup_entry`, `set_thinking_level`, …)
- **THEN** the same observable effect SHALL occur (same outbound messages, same pi calls, same state change) as before the extraction

### Requirement: Source-scanning guard tests follow moved code
A test that asserts on the source text of the bridge entry point to enforce an invariant SHALL, after code it guards moves to another module, scan that module instead. No such guard SHALL pass because its scan target no longer contains the guarded pattern.

#### Scenario: Extracted modules never import the entry point
- **WHEN** a guard test scans the extracted modules' import statements
- **THEN** none SHALL import the bridge entry point

#### Scenario: Guard retargeted after extraction
- **WHEN** the code a guard test scans for moves out of the bridge entry point
- **THEN** the guard test SHALL read the module that now contains that code
- **AND** deliberately re-introducing the guarded anti-pattern in that module SHALL make the guard fail

## MODIFIED Requirements

### Requirement: Session sync extraction
The bridge extension SHALL delegate `sendStateSync()`, `replaySessionEntries()`, and `handleSessionChange()` to a `session-sync` module.

#### Scenario: State sync on reconnect
- **WHEN** the WebSocket connection reconnects
- **THEN** session-sync sends session_register, commands_list, flows_list, and models_list messages

#### Scenario: Session entries replayed
- **WHEN** state sync or session change occurs
- **THEN** session-sync replays all session entries as protocol events
