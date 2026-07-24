## ADDED Requirements

### Requirement: Sidebar tag area is collapsible as one unit

The sidebar SHALL wrap the entire tag filter area (the user-tag group AND the read-only phase group together) in a single master collapse control. The area SHALL default to collapsed. The collapsed master header SHALL display a discoverable count summarizing the hidden contents (number of user tags and number of phase values) so the presence of tags is signaled without unfolding. When any tag or phase filter is currently selected, the collapsed master header SHALL additionally show an active-selection indicator distinct from that count, and SHALL expose a way to clear the active filters without unfolding, so a folded area never silently hides an active filter. The collapse state SHALL persist across page reloads via client-local storage; a first visit with no stored state SHALL render collapsed. Toggling the master control SHALL fold or unfold both groups together, and the control SHALL expose its expanded/collapsed state to assistive technology. Folding the groups under one master control SHALL NOT re-classify phase values as user tags: the read-only phase group remains a distinct, read-only sub-group and the phase-filter-view behavior is unchanged.

#### Scenario: Default collapsed on first load

- **WHEN** the sidebar renders with no stored tag-area fold preference
- **THEN** the tag area SHALL be collapsed
- **AND** both the user-tag group and the phase group SHALL be hidden

#### Scenario: Collapsed header signals contents

- **WHEN** the tag area is collapsed and there are user tags and/or phase values in use
- **THEN** the master header SHALL display a count of user tags and phase values
- **AND** the header SHALL expose `aria-expanded="false"`

#### Scenario: Toggle folds both groups together

- **WHEN** the user activates the master collapse control while collapsed
- **THEN** both the user-tag group and the phase group SHALL become visible
- **AND** the header SHALL expose `aria-expanded="true"`

#### Scenario: Active filter is signaled while collapsed

- **WHEN** a tag or phase filter is selected and the tag area is collapsed
- **THEN** the collapsed master header SHALL show an active-selection indicator distinct from the `N tags · M phases` count
- **AND** a control SHALL allow clearing the active filters without unfolding

#### Scenario: Fold state persists across reload

- **WHEN** the user expands the tag area and reloads the page
- **THEN** the tag area SHALL render expanded
- **AND** collapsing it and reloading SHALL render it collapsed

### Requirement: Sidebar user-tag group caps chip overflow

Within the expanded user-tag filter group, the sidebar SHALL display at most a fixed cap of the first user-tag chips (cap = 10) followed by a `+N more` control that reveals the remaining chips inline without navigation. When the number of user tags is at or below the cap, no overflow control SHALL be shown. Revealing the overflow SHALL be reversible inline (collapse back to the capped view).

#### Scenario: Overflow beyond the cap

- **WHEN** the user-tag group has more user tags than the display cap and the tag area is expanded
- **THEN** the group SHALL show the first cap chips followed by a `+N more` control
- **AND** N SHALL equal the number of hidden chips

#### Scenario: Reveal and re-collapse overflow inline

- **WHEN** the user activates the `+N more` control
- **THEN** all user-tag chips SHALL be shown
- **AND** a control SHALL allow collapsing back to the capped view without navigation

#### Scenario: No overflow control at or below the cap

- **WHEN** the user-tag group has at most cap user tags
- **THEN** no `+N more` control SHALL be rendered

### Requirement: Browser can remove a tag from every session

The browser SHALL be able to strip a single user tag from every session that carries it via a `remove_tag_globally` message carrying `{ tag }`. The server SHALL normalize the inbound tag before matching (the same normalization applied on write); if the normalized tag is empty (blank or whitespace-only input) the server SHALL treat the message as a no-op. Otherwise it SHALL iterate the sessions whose tag list contains the normalized tag, remove that tag from each such session's list, apply the same normalize → in-memory update → debounced persistence-save path used by `set_session_tags`, and broadcast a `session_updated` message for each changed session. Sessions not carrying the tag SHALL be left untouched. Bridges SHALL NOT send `remove_tag_globally`.

#### Scenario: Tag stripped from all carrying sessions

- **WHEN** the browser sends `remove_tag_globally { tag: "explore" }` and three sessions carry `explore`
- **THEN** the server SHALL remove `explore` from each of those three sessions
- **AND** the server SHALL broadcast `session_updated` for each of the three sessions with the tag absent

#### Scenario: Non-carrying sessions untouched

- **WHEN** the browser sends `remove_tag_globally { tag: "explore" }`
- **THEN** sessions that do not carry `explore` SHALL not be modified
- **AND** no `session_updated` SHALL be broadcast for them

#### Scenario: Inbound tag is normalized before matching

- **WHEN** the browser sends `remove_tag_globally { tag: "  Explore " }` and sessions carry the normalized `explore`
- **THEN** the server SHALL normalize the inbound tag to `explore` before matching
- **AND** SHALL strip `explore` from every carrying session

#### Scenario: Removing a tag no session carries is a no-op

- **WHEN** the browser sends `remove_tag_globally { tag: "nonexistent" }`
- **THEN** no session SHALL be modified
- **AND** no `session_updated` SHALL be broadcast

#### Scenario: Blank tag is a no-op

- **WHEN** the browser sends `remove_tag_globally { tag: "   " }`
- **THEN** the normalized tag SHALL be empty and the server SHALL modify no session
- **AND** no `session_updated` SHALL be broadcast

### Requirement: User filter chips offer a guarded global-delete control

Each user-tag chip in the sidebar filter group SHALL offer a destructive remove control (✕) that deletes the tag globally. Activating it SHALL first present a confirmation that names the tag and states how many sessions carry it; only on explicit confirmation SHALL the client send `remove_tag_globally`. The confirmation SHALL make clear the action is not undoable and that the tag can reappear if a session re-adds it. The read-only phase chips SHALL NOT offer this control. The remove control SHALL be a separate control from the filter-toggle affordance — activating remove SHALL NOT also toggle the tag filter — and SHALL be independently keyboard-reachable with an accessible name describing its action and target tag.

#### Scenario: Confirm then delete

- **WHEN** the user activates a user chip's ✕ and confirms the dialog
- **THEN** the client SHALL send `remove_tag_globally { tag }` for that tag
- **AND** the confirmation SHALL have stated the number of sessions carrying the tag

#### Scenario: Cancel leaves everything unchanged

- **WHEN** the user activates a user chip's ✕ and cancels the dialog
- **THEN** no message SHALL be sent
- **AND** the tag SHALL remain on every session

#### Scenario: Phase chips have no delete control

- **WHEN** the phase (read-only) group is rendered
- **THEN** its chips SHALL NOT render a remove control

#### Scenario: Remove is independent of the filter toggle

- **WHEN** the user activates a user chip's ✕
- **THEN** the tag's filter selection state SHALL NOT change
- **AND** the ✕ SHALL be reachable and operable by keyboard with an accessible name naming the action and tag
