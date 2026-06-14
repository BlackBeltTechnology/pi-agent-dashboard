## ADDED Requirements

### Requirement: PendingReplaceProposal field on DashboardSession

The `DashboardSession` type SHALL include an optional
`pendingReplaceProposal?: string | null` field representing a
server-suggested replacement for a manually-attached proposal that the
user has not yet accepted or dismissed. When non-null, the client SHALL
render a replace-proposal dialog.

#### Scenario: Server sets pending replacement

- **WHEN** a session has `attachedProposal = "A"` (manually attached)
- **AND** the server detects an active OpenSpec operation with `changeName: "B"`
- **AND** `"B"` is not in `rejectedReplaceProposals`
- **THEN** the server SHALL set `session.pendingReplaceProposal = "B"`
- **AND** broadcast `session_updated`

#### Scenario: Client renders dialog from field

- **WHEN** a session has `attachedProposal = "A"` AND `pendingReplaceProposal = "B"`
- **THEN** the client SHALL render the replace-proposal dialog
- **AND** the dialog's commit target SHALL initialise to `"B"`

### Requirement: RejectedReplaceProposals field on DashboardSession

The `DashboardSession` type SHALL include an optional
`rejectedReplaceProposals?: string[]` field tracking changeNames the
user has dismissed during the current LLM activity loop.

#### Scenario: Dismissal records rejection

- **WHEN** the client sends `dismiss_replace_proposal { sessionId, changeName: "B" }`
- **THEN** the server SHALL append `"B"` to `session.rejectedReplaceProposals` (deduplicated)
- **AND** clear `session.pendingReplaceProposal`
- **AND** broadcast `session_updated`

#### Scenario: Rejected name does not re-prompt

- **WHEN** `session.rejectedReplaceProposals` contains `"B"`
- **AND** the server detects an active OpenSpec operation with `changeName: "B"`
- **THEN** the server SHALL NOT set `pendingReplaceProposal`
- **AND** SHALL NOT broadcast a session update for this event

### Requirement: Pending replacement coalesces by latest

The server SHALL coalesce pending replacement suggestions into a single
slot: when `pendingReplaceProposal` is already set and a newer event
arrives for a *different* changeName (not in
`rejectedReplaceProposals`), the server SHALL overwrite
`pendingReplaceProposal` with the newer name and broadcast
`session_updated`. The server SHALL NOT queue multiple pending
suggestions.

#### Scenario: Newer event overwrites pending

- **WHEN** `session.pendingReplaceProposal = "B"`
- **AND** the server detects an active operation with `changeName: "C"`
- **AND** `"C"` is not in `rejectedReplaceProposals`
- **THEN** the server SHALL set `session.pendingReplaceProposal = "C"`
- **AND** broadcast `session_updated`

#### Scenario: Same name does not re-broadcast

- **WHEN** `session.pendingReplaceProposal = "B"`
- **AND** the server detects an active operation with `changeName: "B"`
- **THEN** the server SHALL NOT change `pendingReplaceProposal`
- **AND** SHALL NOT broadcast a session update for this event

### Requirement: Accept replace proposal commits attachment

The browser SHALL send `accept_replace_proposal { sessionId, changeName }`
to commit a replacement. The server SHALL set `attachedProposal =
changeName`, run the existing auto-rename path
(`attachRenameTarget`), broadcast `rename_session` to the pi gateway
when the rename target is non-null, clear `pendingReplaceProposal`,
and broadcast `session_updated`.

#### Scenario: Accept commits and renames

- **WHEN** the client sends `accept_replace_proposal { sessionId: "s1", changeName: "B" }`
- **AND** session `"s1"` has `attachedProposal = "A"` and `pendingReplaceProposal = "B"`
- **THEN** the server SHALL set `attachedProposal = "B"`
- **AND** apply auto-rename via `attachRenameTarget`
- **AND** clear `pendingReplaceProposal`
- **AND** broadcast `session_updated`

#### Scenario: Accept does not record rejection

- **WHEN** the client accepts a replacement
- **THEN** the accepted `changeName` SHALL NOT be added to `rejectedReplaceProposals`

### Requirement: Client commit target is independent of server suggestion

The client replace-proposal dialog SHALL maintain a local
`committedTarget` state initialised from the *first*
`pendingReplaceProposal` value it observed when mounting. Subsequent
server updates to `pendingReplaceProposal` SHALL NOT mutate
`committedTarget` automatically.

#### Scenario: Button reflects committed target, not latest suggestion

- **WHEN** the dialog mounts with `pendingReplaceProposal = "B"` (so committed = `"B"`)
- **AND** the server later updates `pendingReplaceProposal` to `"C"`
- **THEN** the dialog's primary button SHALL still read "Replace with B"
- **AND** clicking it SHALL send `accept_replace_proposal { changeName: "B" }`

#### Scenario: Divergence shows banner

- **WHEN** `committedTarget = "B"` AND server `pendingReplaceProposal = "C"`
- **THEN** the dialog SHALL render a banner identifying `"C"` as a newer suggestion
- **AND** the banner SHALL include a `[Use latest]` action

#### Scenario: Use-latest action moves the commit target

- **WHEN** the user clicks `[Use latest]` while the banner is visible
- **THEN** `committedTarget` SHALL be set to the current `pendingReplaceProposal`
- **AND** the banner SHALL hide
- **AND** the primary button label SHALL update to reflect the new committed target

### Requirement: Agent end clears pending and rejected sets

The server SHALL clear both `pendingReplaceProposal` and
`rejectedReplaceProposals` when processing an `agent_end` event for
a session (in addition to clearing `openspecPhase` and
`openspecChange`) and SHALL broadcast the resulting `session_updated`.

#### Scenario: Agent end resets rejection memory

- **WHEN** `session.rejectedReplaceProposals = ["B"]`
- **AND** an `agent_end` event is processed for the session
- **THEN** the server SHALL clear `rejectedReplaceProposals`
- **AND** a subsequent active operation with `changeName: "B"` SHALL set `pendingReplaceProposal = "B"`

### Requirement: Deleted attached proposal bypasses dialog

The server SHALL bypass the replace-proposal dialog when a session's
`attachedProposal` references a change not present in the current
OpenSpec poll cache (archived or deleted): in that case it SHALL
treat the session as having no attachment for the purposes of
activity-driven attach and SHALL auto-attach the new detected
`changeName` directly via the existing auto-attach path without
setting `pendingReplaceProposal`.

#### Scenario: Attached proposal archived, new event auto-attaches

- **WHEN** `session.attachedProposal = "A"` AND `"A"` is not in the OpenSpec poll cache
- **AND** the server detects an active operation with `changeName: "B"`
- **THEN** the server SHALL set `attachedProposal = "B"` directly
- **AND** SHALL NOT set `pendingReplaceProposal`

## MODIFIED Requirements

### Requirement: Server-side auto-attach from activity detection

When the server receives `openspec_activity_update` messages, it SHALL
update the session's `openspecPhase` and `openspecChange` fields
independently. After each update, the server SHALL apply the following
branch logic when `openspecChange` is set and the detected activity has
`isActive: true`:

1. **No attachment** (`attachedProposal` is null/undefined): set
   `attachedProposal = openspecChange` (auto-attach).
2. **Auto-tracked attachment** (the witness rule
   `isNameAutoSetFromAttachment` returns true) AND a different
   `changeName`: set `attachedProposal = openspecChange` and apply
   auto-rename (silent re-attach, mirrors prior behaviour).
3. **Manual attachment, attached proposal still exists**, and
   `changeName !== attachedProposal` and
   `changeName !== pendingReplaceProposal` and `changeName ∉
   rejectedReplaceProposals`: set
   `pendingReplaceProposal = changeName` (surface the conflict via
   the dialog).
4. **Manual attachment, attached proposal no longer exists in poll
   cache**: treat as case 1 (auto-attach the new `changeName`).

Read-only operations (`isActive: false`) SHALL update tracking fields
but SHALL NOT trigger any of the above branches.

#### Scenario: Branch 1 — auto-attach on first active event

- **WHEN** `attachedProposal = null` AND active event for `"B"`
- **THEN** server sets `attachedProposal = "B"`

#### Scenario: Branch 2 — silent re-attach on auto-tracked

- **WHEN** `attachedProposal = "A"` AND `name === "A"` (auto-tracked) AND active event for `"B"`
- **THEN** server sets `attachedProposal = "B"` and applies auto-rename

#### Scenario: Branch 3 — manual attachment surfaces dialog

- **WHEN** `attachedProposal = "A"` (manual, name differs) AND active event for `"B"`
- **AND** `"B" !== pendingReplaceProposal` AND `"B" ∉ rejectedReplaceProposals`
- **THEN** server sets `pendingReplaceProposal = "B"`
- **AND** `attachedProposal` remains `"A"`

#### Scenario: Branch 4 — manual attachment to deleted proposal

- **WHEN** `attachedProposal = "A"` AND `"A"` is not in OpenSpec poll cache
- **AND** active event for `"B"`
- **THEN** server sets `attachedProposal = "B"` directly (no dialog)
