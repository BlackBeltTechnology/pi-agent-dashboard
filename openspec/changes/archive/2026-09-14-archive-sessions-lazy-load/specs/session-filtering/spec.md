## MODIFIED Requirements

### Requirement: Show hidden toggle

The sidebar SHALL include a `Show hidden` toggle as the only filter chip in the header. Hidden sessions are auto-hidden headless workers only; there is no manual hide. When enabled, hidden sessions SHALL reappear in the list with a muted visual style (reduced opacity). Hidden sessions SHALL also show resume/fork buttons. No unhide button SHALL be rendered.

The previous companion `Active only` toggle SHALL be removed; ended sessions are now visible by default inside their folder's collapsible ended-sessions group rather than hidden behind a toggle.

#### Scenario: Show hidden is the only filter chip in the header
- **WHEN** the sidebar header renders
- **THEN** the filter row SHALL contain a `Show hidden` toggle and SHALL NOT contain an `Active only` toggle

#### Scenario: Reveal hidden sessions
- **WHEN** the user enables `Show hidden`
- **THEN** all hidden sessions SHALL appear in the list with reduced opacity and resume/fork action buttons
- **AND** no unhide button SHALL be present

#### Scenario: Unhide a session
- **WHEN** a hidden session is revealed via `Show hidden`
- **THEN** no unhide `[↩]` button SHALL be rendered and no browser message SHALL be able to clear `hidden`; the only way out of the hidden set is the session ending and being archived

### Requirement: Hidden count indicator
When hidden sessions exist and "Show hidden" is OFF, the session list SHALL display an "N hidden workers" indicator at the bottom of the list. N SHALL count only sessions with `hidden = true`; archived sessions SHALL NOT be counted.

#### Scenario: Hidden sessions exist
- **WHEN** one or more sessions are hidden and "Show hidden" is OFF
- **THEN** the list SHALL show "N hidden workers" at the bottom where N is the count

#### Scenario: No hidden sessions
- **WHEN** no sessions are hidden
- **THEN** the hidden count indicator SHALL NOT be displayed

#### Scenario: Archived sessions are not hidden
- **WHEN** 300 sessions are archived and 0 are hidden
- **THEN** the hidden count indicator SHALL NOT be displayed

### Requirement: Filter interaction

The `Show hidden` toggle, server-side hidden flag, per-folder collapsible ended group and per-folder archive fold SHALL work together. The server-side `hidden` flag is the source of truth for `hidden` visibility; the per-folder collapsible group governs `ended` visibility; the archive fold governs `archived` visibility. `Show hidden` SHALL NOT reveal archived sessions.

#### Scenario: Hidden alive session with Show hidden OFF
- **WHEN** an alive session has `hidden = true` and `Show hidden` is OFF
- **THEN** the session SHALL NOT be visible

#### Scenario: Ended session with Show hidden ON
- **WHEN** an ended session has `hidden = true` and `Show hidden` is ON
- **THEN** the session SHALL be visible with muted styling and resume/fork buttons inside its folder's ended group

#### Scenario: Show hidden does not reveal archived
- **WHEN** `Show hidden` is ON and a folder has archived sessions
- **THEN** archived sessions SHALL remain only inside the folder's archive fold

### Requirement: Server-side hidden state
Hidden state SHALL be managed server-side via the in-memory session manager with persistence through the session sidecar. `hidden` SHALL be set only by the auto-hide heuristic or an explicit bridge visibility intent; no browser message SHALL set or clear it. The client-side localStorage hidden set is no longer used. The server SHALL be the source of truth for visibility.

#### Scenario: Migration from client-side hidden
- **WHEN** the client detects a legacy `hiddenSessions` key in localStorage
- **THEN** it SHALL ignore it (server-side hidden flag takes precedence) and remove the key

#### Scenario: No browser verb mutates hidden
- **WHEN** a browser sends a legacy `hide_session` or `unhide_session` message
- **THEN** the server SHALL reject it as an unknown message and SHALL NOT change any session

## REMOVED Requirements

### Requirement: Per-card hide
**Reason**: Manual hiding is replaced by archiving. Hiding kept sessions resident and shipped them to every browser, so it never reduced load; and "hidden" collapsed three unrelated meanings.
**Migration**: Use the per-card archive button on idle or ended sessions (`archive_session`). Ended sessions that were hidden are migrated to archived at boot; alive hidden sessions stay hidden as auto-hidden workers.
