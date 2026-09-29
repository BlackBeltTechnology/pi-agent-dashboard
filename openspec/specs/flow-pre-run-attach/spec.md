# flow-pre-run-attach Specification

## Purpose
Lets a user attach any available flow to a session's flow slot before it runs, so the flow's graph and node cards can be inspected in a stale, empty state and then come alive in place when that flow starts.

## Requirements

### Requirement: FLOWS subcard offers an Open flow action

The FLOWS subcard SHALL show an **Open flow…** action whenever the session's available-flows list is non-empty. Activating it SHALL open a searchable picker listing every flow in the session's available-flows list (project-local and package-provided flows alike), each with its name and description. The action SHALL be disabled, with an explanatory tooltip, while any flow in that session is running.

#### Scenario: Open action visible with flows available
- **WHEN** a session's available-flows list contains at least one flow and no flow is running
- **THEN** the FLOWS subcard SHALL show an enabled **Open flow…** action

#### Scenario: Picker lists all available flows
- **GIVEN** a session whose available-flows list contains a project flow `test:capabilities` and a package flow
- **WHEN** the user activates **Open flow…**
- **THEN** the picker SHALL list both flows by name with their descriptions

#### Scenario: Open action disabled while a flow runs
- **WHEN** a flow in the session is running
- **THEN** the **Open flow…** action SHALL be disabled and SHALL indicate that a flow is running

#### Scenario: Open action hidden with no flows
- **WHEN** the session's available-flows list is empty
- **THEN** no **Open flow…** action SHALL be shown

### Requirement: Attached flow renders in the flow slot as a not-started panel

Picking a flow in the Open picker SHALL attach it to that session's flow slot. The slot SHALL render the same flow panel used for a running flow — header, full DAG graph with its expand dialog, the flow YAML viewer, and the node card grid — built from the flow's definition file, with every node card in the pending state and no run data (no tokens, cost, duration, tool activity, outputs, model, or questions/answers from any earlier run of that flow). The card set and graph topology (nodes and edges) SHALL match what the same flow shows at the moment a real run starts; the not-started panel SHALL NOT draw any node or edge the live panel would not. The header SHALL indicate the flow is not started, SHALL NOT offer Abort, and its expanded form SHALL offer **Run**, **Close**, and the autonomous-mode toggle (the mobile collapsed bar SHALL read as not started; controls appear when expanded). The not-started panel SHALL NOT switch to the completed-flow summary and SHALL NOT show tabs for other flows.

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
- **GIVEN** flow `A` is attached
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

### Requirement: Slot priority between running, attached, and completed flows

The session flow slot SHALL resolve what to render in this order: (1) a running flow; (2) an attached, not-started flow; (3) a completed-flow summary; (4) nothing. A running flow SHALL always take the slot.

#### Scenario: Attached flow overrides a completed summary
- **GIVEN** a session showing a completed-flow summary
- **WHEN** the user attaches a flow
- **THEN** the slot SHALL show the attached not-started panel instead of the summary

#### Scenario: Detach restores an undismissed summary
- **GIVEN** an attached flow shown over an undismissed completed-flow summary
- **WHEN** the user activates **Close**
- **THEN** the attachment SHALL be removed and the slot SHALL show the completed-flow summary again

#### Scenario: Detach with nothing else to show
- **WHEN** the user activates **Close** on an attached flow and no running or completed flow exists
- **THEN** the flow slot SHALL render nothing

### Requirement: Starting the attached flow updates the opened panel in place

When the attached flow starts, the already-opened panel SHALL become that flow's live panel without being torn down and rebuilt: panel collapse state, graph selection, and open dialogs SHALL be preserved, and cards SHALL begin reflecting live run progress. The attachment SHALL then be consumed; after the run completes, the slot SHALL follow normal completed-flow behavior.

#### Scenario: Attached flow starts
- **GIVEN** flow `test:capabilities` is attached and a graph node is selected
- **WHEN** `test:capabilities` starts in the session
- **THEN** the same panel SHALL switch to live mode with the node still selected, and the header SHALL show run progress and **Abort**

#### Scenario: Attached flow completes
- **GIVEN** an attached flow that was started and is now complete
- **WHEN** the slot renders
- **THEN** it SHALL show the completed-flow summary, not the not-started panel

### Requirement: A different flow starting replaces the attached flow

When any flow other than the attached one starts in the session, the attachment SHALL be dropped and the slot SHALL be replaced by the running flow's live panel. No transient panel state (graph/card selection, open dialogs, tab selection) SHALL carry over from the attached panel; the per-session persisted collapse preference continues to apply.

#### Scenario: Other flow starts
- **GIVEN** flow `A` is attached and not started
- **WHEN** flow `B` starts in the session
- **THEN** the slot SHALL show `B`'s live panel and the attachment of `A` SHALL be removed

#### Scenario: Attach while history is still loading
- **GIVEN** a session whose earlier, already-completed flow runs have not yet been replayed to the page
- **WHEN** the user attaches flow `A` and those completed runs then replay
- **THEN** the attachment of `A` SHALL remain and the slot SHALL keep showing `A`'s not-started panel

#### Scenario: Replay reveals a flow that is still running
- **GIVEN** flow `A` is attached while history is still loading
- **WHEN** replay reveals that flow `B` is currently running
- **THEN** the slot SHALL show `B`'s live panel and the attachment of `A` SHALL be removed

#### Scenario: Other flow finished while the page was closed
- **GIVEN** flow `A` was attached, then the page was closed, and flow `B` started after the attach
- **WHEN** the page is reopened and the session's events are replayed
- **THEN** the attachment of `A` SHALL be treated as removed and the slot SHALL follow `B`'s running or completed state

### Requirement: Live flow panel keeps the selected node across run progress

In the live (and not-started) flow panel, a selected graph node / card SHALL stay selected as run progress arrives. Selection SHALL clear only on Esc, on re-selecting the same node, when the displayed flow changes (tab switch or replacement), or when the selected node no longer exists in the displayed flow.

#### Scenario: Selection survives live updates
- **GIVEN** a running flow with node `beta` selected
- **WHEN** new run events arrive for any node
- **THEN** `beta` SHALL remain selected

#### Scenario: Re-attaching starts fresh
- **GIVEN** flow `A`'s panel had node `beta` selected and `A` then completed
- **WHEN** the user attaches `A` again
- **THEN** the not-started panel SHALL have no node selected and no dialog open

#### Scenario: Selection clears on flow change
- **GIVEN** node `beta` selected in flow `A`'s panel
- **WHEN** the displayed flow changes to `B`
- **THEN** no node SHALL be selected

### Requirement: Attachment persists per session on the device

The attachment SHALL be stored on the client per session id and SHALL survive page reloads on the same device. Attachments SHALL be isolated per session: attaching or detaching in one session SHALL NOT affect another session. Storage failure SHALL degrade to in-memory state without errors. Attachments SHALL NOT be shared with other devices or browsers.

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
