# Spec Delta

## MODIFIED Requirements

### Requirement: Attached flow renders in the flow slot as a not-started panel

Picking a flow in the Open picker, or the session's agent calling `flow_open` (see `flow-open-tool`), SHALL attach it to that session's flow slot. The slot SHALL render the same flow panel used for a running flow — header, full DAG graph with its expand dialog, the flow YAML viewer, and the node card grid — built from the flow's definition file, with every node card in the pending state and no run data (no tokens, cost, duration, tool activity, outputs, model, or questions/answers from any earlier run of that flow). The card set and graph topology (nodes and edges) SHALL match what the same flow shows at the moment a real run starts; the not-started panel SHALL NOT draw any node or edge the live panel would not. The header SHALL indicate the flow is not started, SHALL NOT offer Abort, and its expanded form SHALL offer **Run**, **Close**, and the autonomous-mode toggle (the mobile collapsed bar SHALL read as not started; controls appear when expanded), except for a view-only attachment (see "Path-opened flows render read-only"). The not-started panel SHALL NOT switch to the completed-flow summary and SHALL NOT show tabs for other flows.

#### Scenario: Attached flow shows graph and pending cards
- **GIVEN** the user attaches flow `test:capabilities`
- **WHEN** the flow slot renders
- **THEN** it SHALL show the flow's DAG graph and one pending card per card-bearing step, and the header SHALL read as not started

#### Scenario: Not-started header controls
- **WHEN** an attached flow is rendered and not started
- **THEN** the header SHALL show **Run** and **Close**, SHALL NOT show **Abort**, and SHALL NOT show the completed-flow summary

#### Scenario: Run from the not-started panel
- **WHEN** the user activates **Run** on the not-started panel
- **THEN** the flow launch dialog for that flow SHALL open, and submitting it SHALL start that flow in the session
- **AND** **Run** SHALL NOT be activatable again until the panel leaves the not-started state or the start is rejected

#### Scenario: Start is rejected
- **GIVEN** the user submitted **Run** on the not-started panel
- **WHEN** the flow engine rejects the start (for example the flow is unknown or another flow is running)
- **THEN** the panel SHALL stay not started, SHALL show the rejection reason, and **Run** SHALL be activatable again

#### Scenario: Flow starts elsewhere while the Run dialog is open
- **GIVEN** the Run dialog is open on the not-started panel
- **WHEN** any flow starts in the session
- **THEN** the Run dialog SHALL close

#### Scenario: No earlier-run questions in the not-started panel
- **GIVEN** flow `A` ran earlier in the session and asked questions that were answered or cancelled
- **WHEN** `A` is attached and not started
- **THEN** the panel SHALL NOT show any of those questions or answers

#### Scenario: A pending question stays answerable
- **GIVEN** a question from flow `A` is still pending in the session
- **WHEN** `A`'s not-started panel is shown
- **THEN** the pending question SHALL be shown and answerable

#### Scenario: Attached flow no longer available
- **GIVEN** catalog flow `A` is attached (not view-only)
- **WHEN** the session's available-flows list no longer contains `A`
- **THEN** the flow slot SHALL show `A`'s name, a "no longer available" message, and **Close**

#### Scenario: Topology matches a real start
- **GIVEN** a flow whose definition declares routing keys the flow engine does not emit at start
- **WHEN** the flow is attached and later started
- **THEN** the not-started graph and the live graph at start SHALL have the same nodes and edges

#### Scenario: Autonomous toggle before the run
- **GIVEN** the session's last known autonomous mode is off
- **WHEN** an attached flow is rendered and not started
- **THEN** the autonomous toggle SHALL show off, and activating it SHALL toggle autonomous mode for the session and update the toggle

#### Scenario: Autonomous mode never observed
- **WHEN** an attached flow is rendered and the session has no autonomous-mode information yet
- **THEN** the autonomous toggle SHALL show the flow engine's default (on)

#### Scenario: Definition loading
- **WHEN** the attached flow's definition is still being fetched
- **THEN** the flow slot SHALL show the flow name, a loading indicator, and **Close**

#### Scenario: Definition cannot be loaded
- **WHEN** the attached flow's definition file cannot be fetched or parsed, or a step lacks a node type
- **THEN** the flow slot SHALL show the flow name, an error message, and **Close**, and SHALL NOT show a graph or cards

#### Scenario: Agent attaches a flow
- **GIVEN** the user attached flow `A` with the picker in session S
- **WHEN** the agent in S calls `flow_open` for catalog flow `B`
- **THEN** S's flow slot SHALL show `B`'s not-started panel and `A` SHALL no longer be attached

### Requirement: Attachment persists per session on the device

The attachment SHALL be stored on the client per session id and SHALL survive page reloads on the same device. Attachments SHALL be isolated per session: attaching or detaching in one session SHALL NOT affect another session. Storage failure SHALL degrade to in-memory state without errors. An attachment made with the picker, or a Close, SHALL NOT be shared with other devices or browsers. An attachment made by the agent's `flow_open` SHALL be delivered to every connected browser, and each SHALL store its own copy; after that, each copy is independent (closing it on one device SHALL NOT close it on another).

#### Scenario: Attachment survives reload
- **GIVEN** flow `A` is attached in session S and not started
- **WHEN** the page reloads
- **THEN** session S's flow slot SHALL show `A`'s not-started panel again

#### Scenario: Sessions are isolated
- **WHEN** the user attaches a flow in session S1
- **THEN** session S2's flow slot SHALL be unaffected

#### Scenario: Tabs of the same browser stay in sync
- **GIVEN** two tabs of the same browser showing session S
- **WHEN** the user attaches or closes a flow in one tab
- **THEN** the other tab's flow slot SHALL reflect the change

#### Scenario: Storage unavailable
- **WHEN** client storage is unavailable
- **THEN** attaching SHALL still work for the current page lifetime without throwing

#### Scenario: Picker attachment stays on its device
- **GIVEN** a desktop and a phone both show session S
- **WHEN** the user attaches flow `A` with the picker on the desktop
- **THEN** the phone's flow slot SHALL be unchanged

#### Scenario: Agent attachment reaches every device
- **GIVEN** a desktop and a phone both show session S
- **WHEN** the agent in S calls `flow_open` for flow `A`
- **THEN** both SHALL show `A`'s not-started panel
- **AND** closing it on the phone SHALL leave the desktop's attachment in place

## ADDED Requirements

### Requirement: Path-opened flows render read-only

An attachment created from a definition path that is not a catalog flow SHALL be view-only. Its panel SHALL render the graph, YAML viewer and pending node cards, SHALL offer **Close**, and SHALL NOT offer **Run**, the autonomous-mode toggle, or the Edit… menu. It SHALL carry a "view only - not registered" label, and its display name SHALL be the definition path relative to the session working directory.

#### Scenario: Path-opened flow is view-only
- **GIVEN** the agent opened `packages/engine/flows/invoicebot/process` by path and it is not a catalog flow
- **WHEN** the flow slot renders
- **THEN** it SHALL show the graph, pending node cards, the "view only - not registered" label and **Close**
- **AND** it SHALL NOT show **Run**, the autonomous toggle or Edit…

### Requirement: View-only attachments ignore catalog membership

A view-only attachment SHALL NOT show the "no longer available" state because it is absent from the session's flow catalog. It SHALL be replaced or consumed by a starting flow like any other attachment.

#### Scenario: Not in the catalog is not "no longer available"
- **GIVEN** a view-only attachment and a non-empty session catalog that does not contain it
- **WHEN** the flow slot renders
- **THEN** it SHALL show the view-only panel

#### Scenario: A flow starting replaces a view-only attachment
- **GIVEN** a view-only attachment in session S
- **WHEN** any flow starts in S
- **THEN** the slot SHALL show the running flow's live panel and the view-only attachment SHALL be removed

### Requirement: A view-only definition that is no longer served says how to recover

When a view-only attachment's definition can no longer be fetched (for example after a server restart dropped the admitted path), the slot SHALL show the definition-load error, **Close**, and a hint that the agent can open the flow again.

#### Scenario: Definition no longer readable
- **GIVEN** a view-only attachment stored on the device
- **WHEN** the server no longer serves its definition file
- **THEN** the slot SHALL show the flow name, a definition-load error with a hint to ask the agent to open it again, and **Close**
