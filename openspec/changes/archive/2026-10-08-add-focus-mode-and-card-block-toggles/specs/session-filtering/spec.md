## ADDED Requirements

### Requirement: Attention predicate

A session SHALL be considered to need attention when any of the following holds: it is waiting on an interactive question (`ask_user`), its status is `streaming`, its status is `active`, or it is unread. Idle and ended sessions that are not unread and not waiting on a question SHALL NOT need attention.

#### Scenario: Waiting on a question
- **WHEN** a session's current tool is `ask_user`
- **THEN** it SHALL need attention

#### Scenario: Streaming or active
- **WHEN** a session's status is `streaming` or `active`
- **THEN** it SHALL need attention

#### Scenario: Unread
- **WHEN** a session is unread
- **THEN** it SHALL need attention

#### Scenario: Idle and read
- **WHEN** a session is idle, read, and not waiting on a question
- **THEN** it SHALL NOT need attention

### Requirement: Unfocused folder attention filter

In accordion mode, a folder rendering `compact with attention` SHALL show only the session cards that need attention. The filter SHALL apply on top of the hidden-session and search filters: a hidden session SHALL stay hidden (while Show hidden is off) and a non-matching session SHALL stay hidden regardless of attention. When a session stops needing attention, its card SHALL leave the unfocused folder on the next render. The filter SHALL apply equally to pinned and unpinned folders.

#### Scenario: Only attention cards
- **GIVEN** unfocused `/foo` with 5 idle sessions and 1 streaming session
- **THEN** only the streaming session's card SHALL render in `/foo`

#### Scenario: Hidden stays hidden
- **GIVEN** a hidden session waiting on `ask_user` in unfocused `/foo` and Show hidden off
- **THEN** its card SHALL NOT render

#### Scenario: Attention clears
- **GIVEN** a streaming, read session in unfocused `/foo`
- **WHEN** it becomes idle
- **THEN** its card SHALL no longer render in `/foo`

### Requirement: Compact-empty affordance

In accordion mode, a folder rendering `compact empty` SHALL show, below its condensed header, one subdued row reading `N sessions — click to view`, where N counts the folder's sessions after the hidden-session and search filters. Activating the row SHALL focus the folder without changing its collapsed or pinned-open state. When N is zero the row SHALL NOT render.

#### Scenario: Count shown
- **GIVEN** unfocused `/foo` with 18 visible sessions, none needing attention
- **THEN** the row SHALL read `18 sessions — click to view`

#### Scenario: Activating focuses
- **WHEN** the user activates the row of `/foo`, even while a session in another folder is selected
- **THEN** `/foo` SHALL become the focused folder
- **AND** its collapsed and pinned-open state SHALL be unchanged

#### Scenario: Empty folder
- **GIVEN** unfocused `/foo` with zero visible sessions
- **THEN** only its condensed header SHALL render
