## MODIFIED Requirements

### Requirement: Automatic topic naming on terminal turn

When automatic naming is enabled, the bridge extension SHALL attempt to name an eligible session by its topic after each terminal turn (`agent_end`), until the first successful name, a permanent lockout, or exhaustion of the session's attempt budget. A session is eligible only when ALL hold: the global `autoNameSessions` preference is true, the session's `nameSource` is neither `"user"` nor `"system"`, the session has no auto-generated name yet, and the session is not permanently stopped. The first successful auto-name SHALL end all further attempts for that session.

Attempts SHALL NOT continue indefinitely. Each attempt that consumes a model completion SHALL spend one unit of a bounded per-session attempt budget; exhausting it SHALL stop naming permanently for that session.

#### Scenario: Eligible session gets named

- **WHEN** a terminal turn ends for a session that is enabled, not user-named, not system-named, not yet auto-named, and not stopped
- **AND** the enough-info gate passes and the model returns a valid title
- **THEN** the bridge SHALL call `pi.setSessionName(title)` and mark `nameSource = "auto"`
- **AND** SHALL NOT attempt naming again for that session

#### Scenario: Feature disabled

- **WHEN** `autoNameSessions` is false
- **THEN** the bridge SHALL NOT call the model on any turn

#### Scenario: Already auto-named

- **WHEN** a session already has an auto-generated name
- **THEN** subsequent terminal turns SHALL NOT trigger another naming attempt

#### Scenario: System-named session is not auto-named

- **WHEN** a session's `nameSource` is `"system"`
- **THEN** terminal turns SHALL NOT trigger a naming attempt

#### Scenario: Attempts are bounded

- **WHEN** a session repeatedly fails to produce an applicable title
- **THEN** the number of naming completions for that session SHALL be bounded by the attempt budget
- **AND** SHALL NOT grow with the number of terminal turns

### Requirement: Manual rename permanently locks out auto-naming
A name change neither the bridge nor the dashboard originated programmatically — a user-initiated dashboard rename (UI or the REST rename endpoint) or an in-pi rename — SHALL set `nameSource = "user"` and permanently prevent auto-naming for that session. An auto-generated name SHALL set `nameSource = "auto"` and stop the naming loop but SHALL NOT count as a user lock; a later manual rename SHALL still escalate to `"user"`. A rename the dashboard applies programmatically (attach auto-rename, detach auto-revert, trusted-plugin rename) SHALL NOT set `nameSource = "user"`.

#### Scenario: Dashboard rename locks out auto
- **WHEN** the user renames a session from the dashboard
- **THEN** `nameSource` SHALL become `"user"` and no auto-naming SHALL occur thereafter

#### Scenario: REST rename locks out auto without a connected bridge
- **WHEN** a session is renamed via the REST rename endpoint while no bridge is connected
- **THEN** the server SHALL record `nameSource = "user"`

#### Scenario: In-pi rename locks out auto
- **WHEN** the session name changes inside pi and neither the bridge nor the dashboard originated that change
- **THEN** `nameSource` SHALL become `"user"` and no auto-naming SHALL occur thereafter

#### Scenario: Manual rename after an auto-name
- **WHEN** a session was auto-named (`nameSource = "auto"`) and the user then renames it
- **THEN** `nameSource` SHALL become `"user"`

#### Scenario: Manual rename after a system rename
- **WHEN** a session was named programmatically (`nameSource = "system"`) and the user then renames it
- **THEN** `nameSource` SHALL become `"user"`

## ADDED Requirements

### Requirement: Attach auto-name carries system provenance and detach reverts it
When a proposal is attached to a session and the session's `name` field is empty or undefined, the server SHALL automatically set `session.name` to the proposal name, record `nameSource = "system"`, and send a `rename_session` message tagged with `system` origin to the extension. On detach, a name that was auto-set by the attach (it equals the attached proposal) SHALL be reverted unless the session's `nameSource` is `"user"`.

#### Scenario: Session auto-named on proposal attach
- **WHEN** proposal `"add-auth"` is attached to session with `name = undefined`
- **THEN** the server SHALL set `session.name = "add-auth"` and `nameSource = "system"`
- **AND** send `rename_session` to the extension with `name: "add-auth"` and `system` origin
- **AND** broadcast `session_updated` with both `attachedProposal: "add-auth"` and `name: "add-auth"`

#### Scenario: Session name not overwritten on attach
- **WHEN** proposal `"add-auth"` is attached to session with `name = "my work"`
- **THEN** the server SHALL NOT change `session.name`

#### Scenario: Detach reverts an attach-set name
- **WHEN** a proposal is detached from a session whose name was auto-set to the proposal name and whose `nameSource` is not `"user"`
- **THEN** `session.name` SHALL be cleared and `nameSource` and its witness SHALL be cleared
- **AND** the server SHALL send `rename_session` with an empty name and `system` origin

#### Scenario: Detach keeps a user-owned name equal to the proposal
- **WHEN** a proposal is detached from a session whose name equals the proposal name but whose `nameSource` is `"user"`
- **THEN** `session.name` SHALL remain unchanged and no `rename_session` SHALL be sent


### Requirement: Dashboard programmatic renames record `system` provenance

Every rename the server applies programmatically — the attach auto-rename (browser, REST, and auto-attach on a detected change), the detach auto-revert, and a trusted plugin's rename — SHALL be sent to the extension tagged with `system` origin. In the same update that sets the name, the server SHALL record `nameSource = "system"` and the applied name as the provenance witness for a non-empty name, and SHALL clear a `system` provenance and its witness for an empty name. The server SHALL NOT change a `user` provenance on a programmatic rename. A user-initiated rename SHALL NOT be tagged `system`.

#### Scenario: Attach auto-rename records system
- **WHEN** proposal `"add-auth"` is attached to a session with no name
- **THEN** the server SHALL set `name = "add-auth"`, `nameSource = "system"` and witness `"add-auth"`
- **AND** the `rename_session` sent to the extension SHALL carry `system` origin

#### Scenario: Auto-attach on detected change records system
- **WHEN** the server auto-attaches a detected change and auto-renames the session
- **THEN** `nameSource` SHALL be `"system"` and the rename SHALL carry `system` origin

#### Scenario: Plugin rename records system
- **WHEN** a trusted plugin renames a session
- **THEN** `nameSource` SHALL be `"system"` and the rename SHALL carry `system` origin

#### Scenario: User rename is never tagged system
- **WHEN** the user renames a session from the dashboard or via the REST rename endpoint
- **THEN** the `rename_session` sent to the extension SHALL NOT carry `system` origin

#### Scenario: Programmatic rename does not downgrade user
- **GIVEN** a session with `nameSource = "user"`
- **WHEN** a programmatic rename is applied
- **THEN** `nameSource` SHALL remain `"user"`

### Requirement: Server rejects a stale `user` claim for a witnessed name

When the server receives a `session_name_update` from the bridge claiming `nameSource: "user"` while the session's recorded provenance is `auto` or `system`, and the claimed name equals (after pi's session-name sanitization, applied identically on server and bridge) the witness name that provenance was recorded for, the server SHALL keep the recorded provenance and SHALL still apply the name. This SHALL hold even when a provenance-less name update for the same name arrived first. A `user` claim for any other name SHALL be applied and SHALL clear the witness. A bridge claim of `nameSource: "auto"` while the recorded provenance is `system` or `user` SHALL be dropped entirely: neither the name nor the provenance SHALL change.

#### Scenario: Old bridge echo of a system name is rejected
- **GIVEN** a session with `nameSource = "system"` witnessed for `"add-x"`
- **WHEN** a `session_name_update{name:"add-x", nameSource:"user"}` arrives
- **THEN** `nameSource` SHALL remain `"system"`

#### Scenario: Restart relabel of an auto-name is rejected
- **GIVEN** a session with `nameSource = "auto"` witnessed for `"Fix login flow"`
- **WHEN** a `session_name_update{name:"Fix login flow", nameSource:"user"}` arrives after a plain name update with the same name
- **THEN** `nameSource` SHALL remain `"auto"`

#### Scenario: Auto claim does not override a system name
- **GIVEN** a session with `nameSource = "system"`
- **WHEN** a `session_name_update{name:"Some title", nameSource:"auto"}` arrives
- **THEN** `nameSource` SHALL remain `"system"`
- **AND** `session.name` SHALL NOT change

#### Scenario: Genuine rename is accepted
- **GIVEN** a session with `nameSource = "auto"` witnessed for `"Fix login flow"`
- **WHEN** a `session_name_update{name:"my name", nameSource:"user"}` arrives
- **THEN** `nameSource` SHALL become `"user"` and the witness SHALL be cleared

## REMOVED Requirements

### Requirement: Auto-name from attached proposal
**Reason**: Its "Detach does not revert auto-name" scenario contradicts shipped behaviour (`detachShouldClearName`, `openspec-attach-combo` "Idempotent auto-rename revert on detach"). Replaced by "Attach auto-name carries system provenance and detach reverts it", which also records `system` provenance.
**Migration**: None — behaviour already shipped; the replacement requirement documents it.
