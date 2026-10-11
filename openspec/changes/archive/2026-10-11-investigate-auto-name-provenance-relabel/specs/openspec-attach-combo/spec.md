## MODIFIED Requirements

### Requirement: Idempotent auto-rename revert on detach
When a browser sends `detach_proposal`, the server SHALL clear `session.name` (set to `undefined`) if and only if the current `session.name` equals the current `session.attachedProposal` (i.e. the name was auto-set on a previous attach) AND the session's `nameSource` is not `"user"`. When the name was auto-cleared, the server SHALL also clear `nameSource` and its witness, and SHALL forward `rename_session` with an empty name and `system` origin to the bridge so pi's session name is reset.

#### Scenario: Auto-set name reverted on detach
- **WHEN** session has `name: "foo"`, `attachedProposal: "foo"` and `nameSource` other than `"user"`
- **AND** the browser sends `detach_proposal`
- **THEN** the server SHALL update `session.name = undefined`, `session.attachedProposal = null`, `session.openspecPhase = null`, `session.openspecChange = null`
- **AND** the server SHALL send `rename_session { name: "" }` with `system` origin to the bridge
- **AND** the broadcast `session_updated` payload SHALL contain `updates.name = undefined` so the client falls back to `firstMessage` / cwd basename

#### Scenario: User-owned name equal to the proposal preserved on detach
- **WHEN** session has `name: "foo"`, `attachedProposal: "foo"` and `nameSource: "user"`
- **AND** the browser sends `detach_proposal`
- **THEN** the server SHALL update `session.attachedProposal = null`, `session.openspecPhase = null`, `session.openspecChange = null`
- **AND** `session.name` SHALL remain `"foo"`
- **AND** no `rename_session` SHALL be sent to the bridge

#### Scenario: User-customised name preserved on detach
- **WHEN** session has `name: "my custom"` and `attachedProposal: "foo"`
- **AND** the browser sends `detach_proposal`
- **THEN** the server SHALL update `session.attachedProposal = null`, `session.openspecPhase = null`, `session.openspecChange = null`
- **AND** `session.name` SHALL remain `"my custom"`
- **AND** no `rename_session` SHALL be sent to the bridge

#### Scenario: Already-empty name unchanged on detach
- **WHEN** session has `name: undefined` and `attachedProposal: "foo"`
- **AND** the browser sends `detach_proposal`
- **THEN** the server SHALL update `attachedProposal: null`, `openspecPhase: null`, `openspecChange: null`
- **AND** `session.name` SHALL remain `undefined`
- **AND** no `rename_session` SHALL be sent to the bridge

#### Scenario: Name set with no attachment is preserved on a defensive detach
- **WHEN** session has `name: "foo"` and `attachedProposal: null` (defensive: no auto-set witness)
- **AND** the browser sends `detach_proposal`
- **THEN** the server SHALL update `attachedProposal: null`, `openspecPhase: null`, `openspecChange: null`
- **AND** `session.name` SHALL remain `"foo"`
- **AND** no `rename_session` SHALL be sent to the bridge
