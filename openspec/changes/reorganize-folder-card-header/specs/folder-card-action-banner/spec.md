## ADDED Requirements

### Requirement: Directory call-to-action banner

A directory card SHALL render structural calls to action as full-width banner rows, not as
small buttons inside the git-info row. A banner SHALL render directly above the directory state
pills, below the git-facts row when one is present. A directory that renders no git-facts row
(for example a non-repository directory) SHALL place the banner directly below the identity
row, so the element's position is defined in both cases and identity always precedes it.
A banner SHALL NOT render when the directory needs no action.

Banner colours SHALL be drawn from the existing `--severity-{info,warning,error}-{bg,fg,border}`
token triples. The change SHALL introduce no new colour tokens.

A banner SHALL carry a leading icon, a bold headline, an optional detail subline, and a
single trailing action control.

The banner's text region SHALL absorb all horizontal squeeze and SHALL clip its headline and
subline with an ellipsis. The leading icon and the trailing action control SHALL NOT shrink,
and SHALL never be overlapped or displaced by the text. Because a directory path or a list of
missing artifacts is unbounded in length, this SHALL hold at every sidebar width.

#### Scenario: Healthy directory renders no banner

- **GIVEN** a directory that needs no structural action
- **WHEN** its card renders
- **THEN** no banner row SHALL render
- **AND** the card SHALL consume no vertical space for the banner region

#### Scenario: Banner uses severity tokens

- **WHEN** a banner renders at info, warning, or error severity
- **THEN** its background, foreground and border SHALL resolve from the matching
  `--severity-*` triple
- **AND** no raw colour literal SHALL be introduced for the banner surface

#### Scenario: Long detail text clips instead of overlapping the action

- **GIVEN** a banner whose subline names several missing artifacts and is wider than the available space
- **WHEN** the banner renders in a narrow sidebar
- **THEN** the subline SHALL be clipped with an ellipsis inside the text region
- **AND** it SHALL NOT render on top of, behind, or past the trailing action control
- **AND** the trailing action control SHALL remain fully visible and activatable

#### Scenario: Long headline clips independently of the subline

- **GIVEN** a banner whose headline exceeds the available width
- **WHEN** the banner renders
- **THEN** the headline SHALL be clipped with an ellipsis on its own line
- **AND** the subline SHALL remain on a separate line rather than being pushed out of the banner

#### Scenario: Banners stack blocking-first

- **GIVEN** a directory that both failed initialization AND has broken sessions
- **WHEN** its card renders
- **THEN** both banners SHALL render
- **AND** the error-severity banner SHALL render above the warning-severity banner

### Requirement: Tier-0 admits only blocking calls to action

A banner SHALL be used only when the directory cannot proceed without the action. An
optional, non-blocking freshness or update affordance SHALL NOT render as a banner; it
SHALL render as a marker on the corresponding item in the folder actions menu.

#### Scenario: Optional update is a menu marker, not a banner

- **GIVEN** a fully configured directory whose recommended setup templates have since changed
- **WHEN** its card renders
- **THEN** no banner SHALL render for the available update
- **AND** the folder actions menu's project-setup item SHALL carry an update marker

#### Scenario: Banner position is defined without a git row

- **GIVEN** a directory that renders no git-facts row
- **WHEN** it needs a structural action
- **THEN** the banner SHALL render directly below the identity row
- **AND** the identity row SHALL still be the first content row

#### Scenario: Blocking state earns a banner

- **GIVEN** a directory whose declared init hook cannot run until the user re-confirms it
- **WHEN** its card renders
- **THEN** a warning-severity banner SHALL render inviting the user to review the hook

### Requirement: Banner covers every structural directory action

The banner SHALL be the surface for: project setup (absent or incomplete), running a
declared init hook, in-progress and failed init runs, cleaning up broken sessions, and
init-hook re-confirmation. None of these SHALL render as controls inside the git-facts row.

#### Scenario: Init progress replaces the wrapping chip

- **WHEN** an init hook run is in progress for a directory
- **THEN** the progress state SHALL render as a banner row
- **AND** it SHALL NOT be a wide control that wraps out of the git-facts row

#### Scenario: Broken-session cleanup is a banner

- **GIVEN** a directory with at least one ended session whose cwd no longer exists
- **WHEN** its card renders
- **THEN** a banner SHALL offer to clean them up, showing the count
- **AND** no cleanup button SHALL render in the git-facts row

#### Scenario: Progress animation respects reduced motion

- **GIVEN** the user prefers reduced motion
- **WHEN** an in-progress banner renders
- **THEN** its progress indicator SHALL NOT animate

### Requirement: Banner icons are unambiguous

No glyph SHALL carry two distinct meanings on the same directory card. The project-setup
action SHALL NOT reuse the add-to-workspace glyph, and SHALL NOT use a folder-plus glyph
(which reads as "add a folder" beside the card's own folder glyph). The init-hook action
SHALL NOT use a gear-family glyph, which is reserved for directory settings.

#### Scenario: Setup and add-to-workspace are visually distinct

- **WHEN** a project-setup banner and the add-to-workspace menu item are both reachable for a directory
- **THEN** they SHALL render different glyphs

#### Scenario: Init-hook glyph is not gear-family

- **WHEN** the run-init-hook banner renders
- **THEN** its glyph SHALL NOT be a gear or gear-derived glyph
- **AND** it SHALL depict running a declared script
