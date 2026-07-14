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

