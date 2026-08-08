# session-tags Specification

## Purpose
TBD - created by archiving change add-session-tags. Update Purpose after archive.
## Requirements
### Requirement: Session carries user-owned tags

Each session SHALL carry an optional ordered list of user-owned tags. Tags SHALL be
persisted in the session's `.meta.json` sidecar as `SessionMeta.tags: string[]` and
mirrored onto the broadcast `DashboardSession.tags: string[]`. A session with no tags SHALL
be represented by an absent field or an empty array; clients SHALL treat both as untagged.

#### Scenario: Tags persist to the sidecar via the full-overwrite save

- **WHEN** a session's tags change and the debounced persistence save runs
- **THEN** the `.meta.json` full-overwrite save SHALL include the `tags` field (so it is not
  wiped by the non-merge write)
- **AND** `.meta.json` SHALL contain a `tags` array with the normalized tag strings

#### Scenario: Tags restored on cold start

- **WHEN** the server rebuilds a `DashboardSession` from a cached `.meta.json` via
  `sessionFromMeta`
- **THEN** the rebuilt session SHALL carry `tags` from the sidecar
- **AND** a persisted tagged session SHALL remain tagged after a server restart

#### Scenario: Absent tags read as untagged

- **WHEN** a session's `.meta.json` has no `tags` field (e.g. a pre-feature sidecar)
- **THEN** the session SHALL be treated as having zero tags
- **AND** no error SHALL occur

### Requirement: Tags are normalized on write

The server SHALL normalize a tag list before persisting it: trim surrounding whitespace,
lowercase, drop empty strings, remove duplicates (preserving first-seen order), truncate any
tag longer than `MAX_TAG_LEN` (32) characters, and cap the list to `MAX_TAGS` (12) entries.
The persisted array SHALL be the canonical normalized form. Normalization SHALL run
server-side in the handler before persist, regardless of client input.

#### Scenario: Duplicate and blank tags collapse

- **WHEN** the server receives tags `["Feature", "feature", "  ", "bugfix"]`
- **THEN** the persisted array SHALL be `["feature", "bugfix"]`

#### Scenario: Count and length caps enforced

- **WHEN** the server receives a list of 50 tags, one of them 200 characters long
- **THEN** the over-length tag SHALL be truncated to `MAX_TAG_LEN` (32) characters
- **AND** the persisted list SHALL contain at most `MAX_TAGS` (12) entries

### Requirement: Browser can set a session's tags

The browser SHALL be able to replace a session's full tag list via a `set_session_tags`
message carrying `{ sessionId, tags }`. The server SHALL normalize the list (per the
normalization requirement), update the in-memory session (which triggers the debounced
full-overwrite persistence save), and broadcast a `session_updated` message reflecting the
new tags. The handler SHALL NOT call `mergeSessionMeta` (persistence is via the `onChange`
save path). Tag writes are whole-array replace (last-write-wins). Bridges SHALL NOT send
tags.

#### Scenario: Setting tags broadcasts the update

- **WHEN** the browser sends `set_session_tags { sessionId, tags: ["feature", "backend"] }`
- **THEN** the server SHALL persist the normalized tags to the session's `.meta.json`
- **AND** the server SHALL broadcast `session_updated` for that session carrying
  `tags: ["feature", "backend"]`

#### Scenario: Removing all tags

- **WHEN** the browser sends `set_session_tags { sessionId, tags: [] }`
- **THEN** the session SHALL become untagged
- **AND** the broadcast SHALL reflect an empty tag list

### Requirement: Tag color is derived deterministically from the tag name

A user tag's display color SHALL be a pure function of its name —
`TAG_PALETTE[fnv1a32(name) % TAG_PALETTE.length]` over a fixed dark-tuned palette, where the
hash is FNV-1a 32-bit over the normalized lowercase name, applied with unsigned 32-bit
wraparound on every step (`Math.imul(h ^ byte, 0x01000193) >>> 0` in JS) — computed
identically on every surface. No color SHALL be persisted, and there SHALL be no manual
color override.

#### Scenario: Same tag renders the same color everywhere

- **WHEN** the tag `feature` is rendered on a session card, in the detail header, and as a
  sidebar filter chip
- **THEN** it SHALL use the same palette color in all three places
- **AND** no color value SHALL be read from or written to `.meta.json`

#### Scenario: Color is a deterministic hash oracle

- **WHEN** `tagColor` is called for a given tag name
- **THEN** it SHALL return `TAG_PALETTE[fnv1a32(name) % TAG_PALETTE.length]`
- **AND** a unit test SHALL be able to assert the exact expected palette index for a known
  input

### Requirement: Tags are editable via a chip UI

The dashboard SHALL render a session's user tags as colorized chips. Each user chip SHALL
offer a remove control. An add-tag affordance SHALL open a free-form text input that
autocompletes over the union of all tags currently in use across sessions, while still
allowing entry of a brand-new tag. The full editable strip SHALL live in the session detail
header; the session card SHALL show a compact read view that collapses overflow beyond a cap
to a `+N` indicator.

#### Scenario: Add a new tag with autocomplete

- **WHEN** the user opens the add-tag input and types a prefix
- **THEN** existing tags matching the prefix SHALL be offered as suggestions
- **AND** the user SHALL be able to commit either a suggestion or a new tag not yet in use

#### Scenario: Remove a tag

- **WHEN** the user activates a user chip's remove control
- **THEN** that tag SHALL be removed from the session
- **AND** the change SHALL be sent via `set_session_tags` and reflected after broadcast

#### Scenario: Card collapses tag overflow

- **WHEN** a session has more user tags than the card display cap
- **THEN** the card SHALL show the first N chips followed by a `+N` indicator
- **AND** the full set SHALL be visible in the detail header

### Requirement: Chips are keyboard-operable and labeled

Interactive chips (remove control, filter toggle) SHALL be reachable and operable by
keyboard and SHALL expose accessible names describing their action and target tag.

#### Scenario: Keyboard removes a tag

- **WHEN** a user focuses a user chip's remove control and activates it via keyboard
- **THEN** the tag SHALL be removed identically to a pointer activation

### Requirement: Sidebar filters sessions by tag

The sidebar SHALL provide a tag filter group whose chips select user tags, tracked in a
selection set SEPARATE from the phase-chip selection set (so a user tag and a phase value of
the same string do not collide). When no tag chip is selected the tag axis SHALL be inert
(all sessions pass). When one or more tag chips are selected, a session SHALL pass the tag
axis when its `tags` intersect the selected set (OR within the group). The tag axis SHALL
AND-compose with the existing folder filter and session search.

#### Scenario: OR within the tag group

- **WHEN** the user selects `#feature` and `#bugfix`
- **THEN** the list SHALL show sessions tagged `feature` OR `bugfix`

#### Scenario: AND across axes

- **WHEN** `#feature` is selected AND a folder filter of `~/proj/api` is typed AND a session
  search of `auth` is typed
- **THEN** the list SHALL show only sessions under `~/proj/api` matching `auth` tagged
  `feature`

#### Scenario: User tag and phase value of the same name do not collide

- **WHEN** a user tag named `apply` is selected in the tag group but no phase chip is
  selected
- **THEN** sessions SHALL be matched by `session.tags` containing `apply`
- **AND** a session whose `openspecPhase` is `apply` but which lacks the user tag `apply`
  SHALL NOT be matched by the tag-group selection

#### Scenario: No selection is inert

- **WHEN** no tag chip is selected
- **THEN** the tag axis SHALL not remove any session from the list

#### Scenario: Tag axis composes across all folder tiers

- **WHEN** a tag chip is selected
- **THEN** in EVERY folder tier (pinned, unpinned, workspace) a folder containing ≥1 session
  bearing that tag SHALL remain visible AND be expanded to reveal the match, including when
  the matching session is ended
- **AND** a folder with zero sessions matching the selected tag/phase axes SHALL be hidden
  (no empty folder shell), in every tier
- **AND** wherever `workspaceFilter` or `sessionSearch` participates in a folder
  visibility/expand/suppression decision, the tag+phase axes SHALL participate identically

### Requirement: Execution phase chips are a read-only filter view

The sidebar SHALL render read-only pseudo-tag chips derived from the existing session field
`openspecPhase` (NOT `kind`) in a group visually distinct from user tags. These chips SHALL
be selectable as filters but SHALL NOT be editable, and selecting them SHALL NOT write any
session state. The dashboard SHALL NOT persist or emit these as tags. `kind` is excluded:
it is a session classification not a phase, and automation-kind sessions are already removed
from the list before filtering, so a `kind` chip could not function.

#### Scenario: Phase chip filters without writing

- **WHEN** the user selects the read-only `apply` phase chip
- **THEN** the list SHALL show sessions whose `openspecPhase` is `apply`
- **AND** no `.meta.json` SHALL be written as a result of the selection

#### Scenario: Phase chips are not editable

- **WHEN** the user views a session card or detail header
- **THEN** any execution phase chip SHALL be rendered without an add or remove control

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

### Requirement: Tags survive a bridge reattach

A session's user-owned `tags` SHALL survive a bridge reattach, not only a debounced persistence save and a cold-start scan. When a session that already carries `tags` (e.g. restored from `.meta.json` on cold start) is re-registered by its bridge via `register` with `registerReason: "reattach"`, the rebuilt in-memory `DashboardSession` SHALL carry over the existing `tags`. Because the reattach register triggers the full-overwrite `onChange` persistence save, preserving `tags` in memory SHALL also prevent the reattach from wiping `tags` on disk. A FIRST register (no prior in-memory record) SHALL NOT be affected — it carries no tags by construction and remains untagged until the browser sets them.

#### Scenario: Reattach preserves in-memory tags

- **WHEN** a session carrying `tags: ["feature"]` is re-registered with `registerReason: "reattach"`
- **THEN** the rebuilt in-memory session SHALL still carry `tags: ["feature"]`

#### Scenario: Reattach does not wipe tags on disk

- **GIVEN** a session with `tags: ["feature"]` persisted in its `.meta.json`
- **WHEN** the session's bridge reattaches (`register` with `registerReason: "reattach"`) and the resulting `onChange` full-overwrite save runs
- **THEN** the `.meta.json` SHALL still contain `tags: ["feature"]`

#### Scenario: First register carries no tags

- **WHEN** a session is registered for the first time with no prior in-memory record
- **THEN** the session SHALL carry no tags (absent or empty)
- **AND** no tags from any other session SHALL leak onto it

### Requirement: Selected filter chip indicates selection in its own tag color

A user-tone filter chip in the selected state SHALL render a selection indicator that is
visually distinguishable from the unselected state. The indicator's color SHALL be derived
from that chip's own tag color (the deterministic `tagColor(label)` palette entry), NOT
from the ambient inherited text color of the surrounding sidebar. This SHALL hold in both
user-tone filter chip layouts: the plain toggle-only chip, and the chip that additionally
renders the destructive global-delete ✕ control. In BOTH layouts the indicator SHALL be
hosted on the toggle itself, so it fits the chip. The indicator SHALL NOT be the sole signal
of selection — `aria-pressed` remains the programmatic selected-state signal.

#### Scenario: Selection indicator color tracks the tag color

- **WHEN** a user-tone filter chip for tag `dashboard` is rendered in the selected state
- **THEN** its selection indicator color SHALL equal the `tagColor("dashboard")` palette
  color
- **AND** it SHALL NOT resolve to the inherited ambient text color of the sidebar

#### Scenario: Remove-enabled selected chip is indicated on the toggle, not the wrapper

- **WHEN** a user-tone filter chip is selected AND a global-delete ✕ control is enabled for
  it
- **THEN** the selection indicator SHALL be hosted on the toggle, fitting the chip
- **AND** the enclosing wrapper SHALL render NO indicator of its own
- **AND** the ✕ SHALL fall OUTSIDE the indicator, because it is a destructive action rather
  than part of the selection state
- **AND** the indicator color SHALL still be derived from that chip's tag color
- **AND** the toggle and the ✕ SHALL remain on one line as a single unit

#### Scenario: The indicator fits the chip rather than enclosing the ✕

- **GIVEN** hosting the indicator on the wrapper measured 67.9×24 CSS px around a 41.9×19.8
  chip — +28 px wide and +6.2 px tall, because the wrapper also spans the ✕'s ≥24 px hit area
- **WHEN** a remove-enabled user-tone filter chip is selected
- **THEN** the indicator's box SHALL track the toggle's box, not the wrapper's

#### Scenario: Unselected chip renders no selection indicator

- **WHEN** a user-tone filter chip is rendered in the unselected state
- **THEN** no selection indicator SHALL be rendered
- **AND** `aria-pressed` SHALL be `false`

#### Scenario: Selection behavior is unchanged

- **WHEN** the user activates a selected or unselected user-tone filter chip
- **THEN** the chip's toggle handler SHALL fire exactly as before
- **AND** the tag filter axis composition, the global-delete ✕ behavior, and tag
  persistence SHALL be unaffected

