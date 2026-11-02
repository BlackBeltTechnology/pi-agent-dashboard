## REMOVED Requirements

### Requirement: Flow panel collapse state persists per session

**Reason**: Replaced by "Flow panel starts collapsed and keeps the user choice per session", which keeps per-session persistence and changes the default from expanded to collapsed (the panel never expands on its own).
**Migration**: Stored choices keep working (same storage keys); sessions without a stored choice now start collapsed.

## ADDED Requirements

### Requirement: Flow panel starts collapsed and keeps the user choice per session

The collapse/expand state of the flow socket SHALL persist per session across remounts and page reloads, so a user who collapses a session's flow panel does not have to collapse it again every time that session re-renders. Two collapse states are persisted, each keyed by session id:

- the **whole-panel collapse** of the completed-flow `FlowSummary` (its `panelCollapsed`), and
- the **live `FlowDashboard` collapse** (its `collapsed`).

State SHALL be stored on the frontend in `localStorage`, under keys namespaced by both purpose and session id (e.g. `dashboard:flow-summary-collapsed:<sessionId>` and `dashboard:flow-dashboard-collapsed:<sessionId>`). Reads and writes SHALL be wrapped so a `localStorage` failure (quota, disabled storage, private mode) degrades to in-memory state without throwing. A session with no stored state SHALL default to **collapsed**: the flow panel SHALL never expand on its own when a flow starts, progresses, completes or fails. It SHALL expand only when the user expands it, or when the user chooses Open flow… (an explicit request to see that flow). The user's choice SHALL persist per session as before. Persistence SHALL be scoped per session id: collapsing one session's panel SHALL NOT change another session's persisted state. The Summaries-list subsection toggle and the agent-row expansion remain ephemeral (not persisted) in this change.

#### Scenario: Collapse is remembered on remount
- **WHEN** the user collapses a session's flow panel and that component later remounts (navigation, reload, re-render)
- **THEN** the panel SHALL render collapsed for that session without further user action

#### Scenario: Untouched session defaults to collapsed
- **WHEN** a session's flow panel has no stored collapse state
- **THEN** it SHALL render collapsed to its one-line header

#### Scenario: A starting flow does not open the panel
- **WHEN** a flow starts in a session with no stored state
- **THEN** the panel SHALL show only its header with the running status

#### Scenario: Per-session isolation
- **WHEN** the user collapses session A's flow panel
- **THEN** session B's persisted collapse state SHALL be unchanged, and session B SHALL still render per its own stored (or default) state

#### Scenario: Live dashboard collapse persists independently
- **WHEN** the user collapses the live `FlowDashboard` for a session
- **THEN** that collapse SHALL be restored for the same session on remount, independently of the `FlowSummary` whole-panel collapse

#### Scenario: localStorage failure degrades gracefully
- **WHEN** reading or writing `localStorage` throws (disabled/quota/private mode)
- **THEN** the collapse toggle SHALL still function for the current mount using in-memory state and SHALL NOT throw

#### Scenario: A failed flow does not open the panel
- **WHEN** a flow in a session with no stored state fails
- **THEN** the panel SHALL show only its header with the failed status
- **AND** the graph and cards SHALL stay hidden until the user expands it

#### Scenario: A new run keeps the user's choice
- **GIVEN** the user collapsed the panel for a session
- **WHEN** a new flow starts in that session
- **THEN** the panel SHALL stay collapsed

#### Scenario: Open flow expands the panel
- **WHEN** the user chooses Open flow… and picks a flow
- **THEN** the panel SHALL expand to show that flow

#### Scenario: Collapse survives selecting the session again
- **GIVEN** the user collapsed a session's flow panel
- **WHEN** the user selects that session again (sidebar click, route change)
- **THEN** the panel SHALL stay collapsed
