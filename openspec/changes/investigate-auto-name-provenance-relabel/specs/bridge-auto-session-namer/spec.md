## MODIFIED Requirements

### Requirement: External-rename lockout and provenance seeding

The bridge SHALL treat an observed session name as an external rename only when it matches neither its own last self-applied title nor the last name the dashboard applied programmatically (`system` origin). Comparisons SHALL use pi's session-name sanitization on both sides. An external rename SHALL permanently lock out auto-naming and report provenance `user`. The bridge SHALL honor provenance restored from the server on every session registration — after a pi process restart and when it switches to or resumes a session, not only across an in-process extension reload — including when a naming state machine already exists for the session because an observation preceded the restore.

#### Scenario: External rename detected

- **WHEN** the observed session name differs from the bridge's last self-applied title and from the last system-applied name
- **THEN** the bridge sets the name source to `user`, permanently stops naming, and sends a `session_name_update` with `nameSource: "user"`

#### Scenario: Self-applied name ignored

- **WHEN** the observed session name equals the bridge's last self-applied title
- **THEN** the bridge takes no action and continues in its post-success stopped state

#### Scenario: Seed provenance on reconnect

- **WHEN** provenance restored from persisted metadata is `user`
- **THEN** the bridge marks the name source `user` and stays permanently stopped
- **AND WHEN** the restored provenance is `auto`, the bridge marks the session already auto-named, treats the restored witness name as its last self-applied title, and does not attempt naming again
- **AND WHEN** the restored provenance is `system`, the bridge marks the name source `system`, treats the restored witness name as the last system-applied name, and does not attempt naming

#### Scenario: Own auto-name survives a process restart

- **GIVEN** a session the bridge auto-named, persisted with provenance `auto`
- **WHEN** the pi process restarts and the session's next terminal turn observes that same name
- **THEN** the bridge SHALL classify it as self-applied
- **AND** SHALL NOT send `session_name_update` with `nameSource: "user"`
- **AND** the persisted provenance SHALL remain `auto`

#### Scenario: Own auto-name survives a session resume

- **GIVEN** a session auto-named in an earlier pi process, persisted with provenance `auto`
- **WHEN** a running bridge switches to (resumes) that session and a terminal turn observes its name
- **THEN** the bridge SHALL classify it as self-applied and SHALL NOT latch `user`

#### Scenario: Restore arriving after an observation still applies

- **GIVEN** a restarted session persisted with provenance `auto` for name `"A"`
- **WHEN** the live name `"A"` is observed (and wrongly classified external) before the session's restore arrives
- **THEN** on receiving the restore the bridge SHALL replace its `user` provenance with the restored `auto` provenance and clear the stop that latch set
- **AND** the next observation of `"A"` SHALL be classified self-applied

#### Scenario: Restore never downgrades a genuine live user lock

- **GIVEN** a namer that latched `user` because the live name is `"B"`
- **WHEN** a restore arrives with provenance `auto` for witness `"A"`
- **THEN** the bridge SHALL keep provenance `user` and its stop

#### Scenario: Genuine rename in the restore race is still detected

- **GIVEN** a session restored with provenance `auto` for name `"A"`
- **WHEN** the live session name is `"B"` at the next terminal turn
- **THEN** the bridge SHALL classify `"B"` as external and latch `user`

#### Scenario: Restored provenance without a witness

- **GIVEN** persisted provenance `auto` with no recorded witness name
- **WHEN** the session registers and its name is observed for the first time
- **THEN** the bridge SHALL treat the session as auto-named and adopt the observed name as the witness
- **AND** SHALL NOT latch `user` on that first observation
- **AND** a later observation of a DIFFERENT name SHALL be classified external

#### Scenario: A stop latched by a wrong user classification is cleared by the restore

- **GIVEN** a session whose naming was stopped only because an observation was classified external (no budget, role, registry, or credential cause)
- **WHEN** the restored provenance is `auto` or `system`
- **THEN** that stop SHALL be cleared
- **AND** a stop with a budget, role, registry, credentials, or other cause SHALL remain in force

#### Scenario: Unknown restored provenance is ignored

- **WHEN** the restored provenance is not one of `auto`, `user`, `system`
- **THEN** the bridge SHALL ignore it and keep its current provenance

### Requirement: Eligibility and pre-filter gating

The bridge SHALL attempt naming only for an eligible, un-named session, and SHALL skip trivial openers without any model call. The pre-filter SHALL evaluate the advancing transcript window rather than permanently the first user message.

#### Scenario: Eligibility gate

- **WHEN** a naming attempt runs and any of these hold: the toggle is off, the name source is `user`, the name source is `system`, or an auto-name was already applied
- **THEN** the bridge does not call the model

#### Scenario: Trivial-opener pre-filter

- **WHEN** the most recent substantive user message is a pure greeting (e.g. `hi`, `test`, `thanks`), shorter than 15 characters after trimming, or a bare slash-command
- **THEN** the bridge skips the attempt with no model call

#### Scenario: A trivial latest message does not mask a substantive session

- **GIVEN** a session whose conversation contains a substantive user message
- **WHEN** the most recent user message is a bare confirmation such as `ok` or `thanks`
- **THEN** the pre-filter SHALL select the most recent SUBSTANTIVE user message
- **AND** SHALL NOT skip the attempt merely because the latest message is trivial

### Requirement: The stop is durable and clears by re-resolution

A permanent stop SHALL survive a bridge reload: the bridge SHALL NOT re-attempt naming, and SHALL NOT re-emit `auto_name_error`, for a session already stopped before the reload. The attempt budget already spent SHALL likewise survive reload, so the bound cannot be defeated by reloading.

Carried state SHALL be an explicitly enumerated set of values — the stop flag, the error-emitted flag, the attempts spent, the model reference the session stopped on, the provenance, the auto-named flag, the last self-applied title, and the last system-applied name — and SHALL NOT be carried by retaining the namer object itself, whose closures would reference a stale connection, session id, and context.

The stop SHALL clear when the RESOLVED naming model reference changes, evaluated at the next attempt and BEFORE the stop short-circuits the attempt. Clearing SHALL NOT depend on receiving a roles-change event, because a role write is routed to a single session's bridge and would never reach the other stopped sessions.

Assigning a model that resolves to the SAME reference the session stopped on SHALL NOT clear the stop, because the failing configuration is unchanged.

Clearing the stop SHALL also reset the spent attempt budget AND re-arm error emission. Without both resets the operator's remedy is vacuous: the session would retry once, immediately re-exhaust the budget, and re-stop with NO error, because the one-shot error flag was still latched.

A stop whose cause was NOT the model reference — unresolvable credentials, a model absent from the registry, or no configured role at all — SHALL also clear when that cause is resolved, even though the resolved reference is unchanged or was previously absent.

Durability SHALL span a process restart, not only an extension reload. The stop state SHALL be persisted in the session's `.meta.json` record, alongside `nameSource` — the same lifecycle, already owned by the server. This is an explicit, narrowly-scoped exception to the change's "no new persisted field" constraint: without it a restart silently re-spends a full budget, re-emits the error, and the stop is not in fact permanent. Across a process restart or session resume, provenance SHALL be restored from the server-owned `nameSource` and its witness name, not from the provenance fields of the bridge-persisted stop state.

#### Scenario: Stop survives reload

- **GIVEN** a session whose naming has been permanently stopped
- **WHEN** the bridge extension reloads
- **THEN** the bridge SHALL make no further naming attempt for that session
- **AND** SHALL NOT emit a second `auto_name_error` for the same stop

#### Scenario: Spent budget survives reload

- **GIVEN** a session that has spent part of its attempt budget
- **WHEN** the bridge extension reloads
- **THEN** the spent count SHALL be preserved
- **AND** the budget SHALL NOT reset to zero

#### Scenario: Reassigning the naming model clears the stop on every session

- **GIVEN** two stopped sessions on separate bridges
- **WHEN** the operator assigns a different model to the naming role via one of them
- **THEN** BOTH sessions SHALL clear the stop at their next attempt
- **AND** clearing SHALL NOT require the session to have handled the role write

#### Scenario: Reassigning the same effective model does not clear the stop

- **GIVEN** a session stopped on a resolved model reference
- **WHEN** the operator assigns a model that resolves to that same reference
- **THEN** the stop SHALL remain in force

#### Scenario: Clearing restores a full budget and re-arms the error

- **GIVEN** a session stopped with its attempt budget exhausted and its error already emitted
- **WHEN** the stop clears because the resolved naming reference changed
- **THEN** the spent budget SHALL reset to zero
- **AND** a subsequent exhaustion SHALL emit a new `auto_name_error`
- **AND** the session SHALL NOT re-stop after a single attempt

#### Scenario: A credential fix clears a credential-caused stop

- **GIVEN** a session stopped because credentials for the naming model could not be resolved
- **WHEN** the operator configures those credentials
- **THEN** the stop SHALL clear at the next attempt
- **AND** clearing SHALL NOT require the resolved model reference to change

#### Scenario: The stop survives a process restart

- **GIVEN** a session whose naming has been permanently stopped
- **WHEN** the pi process restarts
- **THEN** the bridge SHALL make no further naming attempt for that session
- **AND** SHALL NOT emit a further `auto_name_error` for the same stop
- **AND** SHALL NOT re-spend the attempt budget

#### Scenario: Clearing the stop does not override a user rename

- **GIVEN** a session locked out with provenance `user`
- **WHEN** the naming model is reassigned
- **THEN** the lockout SHALL remain in force

## ADDED Requirements

### Requirement: Dashboard-originated renames are classified `system`

When the server delivers a rename tagged with `system` origin, the bridge SHALL apply the provenance change synchronously, BEFORE applying the name to pi, and SHALL record the name as the last system-applied name, so the session-name change pi reports back is classified `system` rather than external. A `system` classification SHALL NOT lock out auto-naming and SHALL NOT report provenance `user`. A non-empty `system` rename SHALL supersede an earlier auto-name (the session is no longer considered auto-named). A `system` rename SHALL NOT downgrade an existing `user` provenance. A `system` rename to an empty name SHALL clear a `system` provenance, without relying on any echo from pi, so the session becomes eligible for auto-naming again. A latched `user` provenance SHALL clear the last system-applied name. A rename without an origin SHALL be handled exactly as before.

#### Scenario: Attach auto-rename echo is not a user rename

- **WHEN** the server sends a `system`-origin rename `"add-x"` and pi reports the session name changed to `"add-x"`
- **THEN** the bridge SHALL NOT send `session_name_update` with `nameSource: "user"`
- **AND** the name source SHALL be `system`

#### Scenario: Genuine rename after a system rename escalates to user

- **GIVEN** a session whose name source is `system`
- **WHEN** the session is renamed to a different name the dashboard did not originate
- **THEN** the name source SHALL become `user` and auto-naming SHALL be permanently locked out

#### Scenario: System rename does not downgrade a user lockout

- **GIVEN** a session whose name source is `user`
- **WHEN** a `system`-origin rename is applied
- **THEN** the name source SHALL remain `user`

#### Scenario: System clear re-enables auto-naming, even after an earlier auto-name

- **GIVEN** a session that was auto-named and then renamed by a `system`-origin rename
- **WHEN** a `system`-origin rename to an empty name is applied
- **THEN** the name source SHALL be cleared and the session SHALL NOT be considered auto-named
- **AND** a later eligible terminal turn SHALL be allowed to auto-name the session

#### Scenario: System rename during an in-flight naming call

- **GIVEN** a naming model call in flight
- **WHEN** a `system`-origin rename is applied before the call returns a valid title
- **THEN** the bridge SHALL NOT apply the title and SHALL NOT overwrite the system name
- **AND** SHALL report outcome `already-named`, not `locked-out`

#### Scenario: System-named session makes no model call

- **WHEN** a terminal turn ends for a session whose name source is `system`
- **THEN** the bridge SHALL NOT call the naming model and SHALL report outcome `already-named`

#### Scenario: User rename echo after a system rename locks out

- **GIVEN** a session whose last system-applied name is `"add-x"`
- **WHEN** the server sends a rename without an origin and pi reports the new name
- **THEN** the bridge SHALL classify it external and latch `user`

#### Scenario: Failed system rename leaves provenance unchanged

- **WHEN** a `system`-origin rename is received and applying the name to pi fails
- **THEN** the bridge SHALL restore its prior provenance and last system-applied name
- **AND** a later observation of the unchanged name SHALL NOT latch `user`

#### Scenario: Untagged rename keeps prior behaviour

- **WHEN** the server sends a rename without an origin and pi reports the change
- **THEN** the bridge SHALL classify it exactly as before this change

### Requirement: Server restores provenance at every registration

On every session registration, the server SHALL send `auto_name_state_restore` when the session has persisted naming state OR a recorded `nameSource`, carrying the recorded `nameSource` and its witness name from the server-owned session record, not from bridge-persisted state. When the recorded `nameSource` is not `user`, a persisted stop carrying no stop cause SHALL be restored as not stopped.

#### Scenario: Provenance without naming state is still restored

- **WHEN** a session registers with `nameSource = "system"` and no persisted naming state
- **THEN** the server SHALL send `auto_name_state_restore` carrying `nameSource: "system"` and its witness

#### Scenario: Stale bridge-persisted provenance is not trusted

- **GIVEN** a session record with `nameSource = "auto"` whose persisted naming state says `nameSource: "user"`
- **WHEN** the session registers
- **THEN** the restore SHALL carry `nameSource: "auto"`
