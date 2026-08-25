## MODIFIED Requirements

### Requirement: Folder actions menu replaces the header action cluster

The folder header SHALL expose exactly one trailing control: a folder actions menu trigger.

Every directory mutation on the card SHALL be reachable from that menu and SHALL NOT also render as a standalone control. The only mutation permitted outside the menu is the tier-0 banner's own call to action, which exists precisely because the folder cannot proceed without it. The init and cleanup controls that formerly sat on the deleted `FolderActionBar` are no longer an exception: initialization renders in the tier-0 banner, and cleanup is an item in this menu's `DIRECTORY` group.

The previous carve-out — that the slot pills' own action buttons were "outside its scope and continue to render" — no longer holds. Every slot action is now an item in this menu, and the pill grid is state-only.

**Accepted duplication.** The `AddToWorkspaceMenu` popover already offers its own
remove-from-workspace entry. The gesture is reachable both from that popover and from the folder
actions menu's workspace group. Both SHALL continue to work and SHALL have identical effect.

Activating the trigger SHALL stop click propagation so it neither navigates to the directory
home page nor toggles the folder's collapsed state.

Menu open state SHALL be keyed per folder scope so opening one folder's menu never opens
another's.

#### Scenario: Cluster is a single control

- **WHEN** a folder header renders its trailing cluster
- **THEN** exactly one control SHALL render in the cluster
- **AND** the urgency-sort, pin, add-to-workspace, remove-from-workspace and directory-settings controls SHALL NOT render as separate cluster buttons

#### Scenario: No mutation control renders outside the menu

- **WHEN** an expanded folder card renders
- **THEN** no mutation control SHALL render outside the folder actions menu, other than the tier-0 banner's call to action
- **AND** the slot pills SHALL render no action buttons

#### Scenario: The card carries no separate init or cleanup row

- **WHEN** an expanded folder card renders
- **THEN** no action row SHALL render between the git row and the slot pills other than the tier-0 banner

#### Scenario: Opening the menu neither navigates nor collapses

- **GIVEN** an expanded folder
- **WHEN** the user activates the folder actions trigger
- **THEN** the menu SHALL open
- **AND** the client SHALL NOT navigate to the directory home page
- **AND** the folder SHALL remain expanded

#### Scenario: Menus are scoped per folder

- **GIVEN** two folder headers rendered in the sidebar
- **WHEN** the user opens one folder's actions menu
- **THEN** the other folder's menu SHALL remain closed

## ADDED Requirements

### Requirement: Menu carries a permanent Project setup item

The `DIRECTORY` group SHALL contain a permanently rendered `Project setup…` item with one stable label, regardless of the directory's setup state, so its position is learnable. The item SHALL display the per-artifact tally as `n/N`, including `5/5` for a fully set-up directory.

Division of labour: the **banner carries urgency**, the **menu carries availability**. A directory with no banner SHALL still expose this item.

The item SHALL carry a `● update` badge when init-status reports `setupOutdated === true`, and no badge when the field is absent or false.

#### Scenario: Item present on a fully configured directory

- **GIVEN** a directory whose checklist reports every artifact present
- **WHEN** the folder actions menu opens
- **THEN** the `DIRECTORY` group SHALL contain `Project setup… 5/5`

#### Scenario: Tally reflects partial state

- **GIVEN** a directory whose checklist reports 3 of 5 present
- **WHEN** the menu opens
- **THEN** the item SHALL read `Project setup… 3/5`

#### Scenario: Update badge is driven by setupOutdated

- **GIVEN** a directory reporting `setupOutdated: true`
- **WHEN** the menu opens
- **THEN** the item SHALL carry a `● update` badge

#### Scenario: Absent staleness field shows no badge

- **GIVEN** an init-status payload omitting `setupOutdated`
- **WHEN** the menu opens
- **THEN** the item SHALL carry no badge

### Requirement: Menu hosts the broken-session cleanup action

`Clean up broken (N)` SHALL render as an item in the `DIRECTORY` group, carrying the count of the folder's ended sessions whose directory is missing, and SHALL be absent when that count is zero. It SHALL NOT render in the tier-0 banner: it is housekeeping and does not block the folder.

The item SHALL follow the menu's existing `folder-menu-item-<id>` test-id convention with item id `cleanup-broken`, yielding `folder-menu-item-cleanup-broken` and superseding the card-level `folder-cleanup-broken-btn`.

The `DIRECTORY` group is used deliberately because it already exists; this requirement does not depend on any later change introducing a `MAINTENANCE` group.

#### Scenario: Cleanup appears in the menu when broken sessions exist

- **GIVEN** a folder with 3 ended sessions whose directories are missing
- **WHEN** the folder actions menu opens
- **THEN** the `DIRECTORY` group SHALL offer a cleanup item naming the count 3

#### Scenario: Cleanup is absent when nothing is broken

- **GIVEN** a folder with no broken sessions
- **WHEN** the menu opens
- **THEN** no cleanup item SHALL render
