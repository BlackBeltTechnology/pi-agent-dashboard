# agent-teams-session-badge Specification

## Purpose
TBD - created by archiving change add-agent-teams-ui. Update Purpose after archive.

## Requirements

### Requirement: Session cards show a role badge

The plugin SHALL register an eager `session-card-badge` claim gated by the predicate `isTeamSession`, true exactly when the session's top-level plugin-ref projection holds a non-empty string `teamId` under key `agent-teams` (teammates, written by core's spawn) or `agent-teams-lead` (leads). When both keys are present the lead variant wins. The badge SHALL show `Lead` or the member name and link to `/session/<id>/team`.

#### Scenario: Teammate badge
- **WHEN** a teammate session card renders
- **THEN** it shows the member name and links to its Team view

#### Scenario: Plain session
- **WHEN** a session has neither ref, or a cleared ref with `teamId` null or an empty string
- **THEN** the predicate is false and no badge or empty status subcard appears

#### Scenario: Both refs
- **WHEN** a session holds both `agent-teams` and `agent-teams-lead` refs
- **THEN** the predicate is true and the badge reads `Lead`

### Requirement: Lead sessions are stamped from core store events

The server SHALL stamp the lead session with `{teamId}` under key `agent-teams-lead` through `assignSessionRef` with persistence when core emits `team_created` or `lead_bound`, and SHALL clear it with `{teamId: null}` when the session leads no live team. The stamp SHALL be recomputed idempotently from the store's live teams (`reconcileStamp(sessionId)`) on any team event. A failed stamp SHALL be logged once and SHALL NOT affect team operation.

#### Scenario: Lead becomes lead
- **WHEN** a session creates a team through any path (tool, auto-create, command start or server-started lead)
- **THEN** its card shows the badge in the live session list without a reload

#### Scenario: Team closed
- **WHEN** the team closes
- **THEN** the lead card loses its badge without a reload, because the clear is sent as a JSON-plain value

#### Scenario: Late close of an old team
- **WHEN** a lead closes team A, creates team B and A's `team_closed` is handled after `team_created(B)`
- **THEN** the lead keeps its badge for B

#### Scenario: Lead rebound
- **WHEN** `lead_bound` names a new session for an existing team
- **THEN** the old session's stamp is cleared, the new session is stamped and repeating the event changes nothing

#### Scenario: Stamp survives restart
- **WHEN** the server restarts with an active team
- **THEN** the lead card still shows the badge before any REST call completes

### Requirement: Badge is accessible and dependency-light

The badge SHALL be a keyboard-focusable link with a visible focus indicator and an accessible name stating the role, SHALL show text so that role never depends on color, SHALL import no icon packages and SHALL add only its own labels to the eager i18n catalog.

#### Scenario: Keyboard use
- **WHEN** the user tabs to the badge and presses Enter
- **THEN** the Team view opens

#### Scenario: Chunk budget
- **WHEN** the client is built
- **THEN** the cold-chunk size contract test still passes without raising its cap
