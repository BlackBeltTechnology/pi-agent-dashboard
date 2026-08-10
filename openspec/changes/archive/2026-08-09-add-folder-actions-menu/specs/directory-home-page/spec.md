## MODIFIED Requirements

### Requirement: Whole-row open affordance

The folder header name-row SHALL itself be the open affordance: activating it SHALL navigate
to `/folder/:encodedCwd`. The folder name SHALL carry a hover affordance so the row reads as a
link.

There SHALL be no separate icon open affordance. The row click is the only open gesture on the
card, so the destination has exactly one control.

Child controls within the row SHALL stop propagation so they perform their own action instead
of navigating.

Activating the row SHALL NOT toggle the folder's collapsed state; collapse lives solely on the
chevron in the drag gutter.

The open gesture SHALL be reachable by keyboard. Because the row also hosts the folder actions
menu trigger, and a button may not nest inside a link, the link semantics SHALL live on the
folder name region rather than on the row element itself.

#### Scenario: Row click opens the home page

- **WHEN** the user activates a directory header row (pinned, unpinned, or workspace-owned)
- **THEN** the client SHALL navigate to `/folder/<encodedCwd>` for that directory

#### Scenario: No dedicated icon open control renders

- **WHEN** a directory header row renders
- **THEN** no separate icon-only open control SHALL render in the header cluster

#### Scenario: Child controls do not trigger whole-row navigation

- **GIVEN** a folder header row carrying the folder actions menu trigger
- **WHEN** the user activates that trigger
- **THEN** the menu SHALL open
- **AND** the client SHALL NOT navigate to the directory home page

#### Scenario: Whole-row navigation does not collapse the folder

- **GIVEN** a folder is expanded
- **WHEN** the user activates its header row
- **THEN** the folder SHALL remain expanded

#### Scenario: Folder name is keyboard reachable

- **WHEN** a directory header row renders
- **THEN** the folder name region SHALL expose link semantics and SHALL be focusable
- **WHEN** the user focuses it and presses Enter
- **THEN** the client SHALL navigate to `/folder/<encodedCwd>` for that directory

#### Scenario: Folder name signals it is a link

- **WHEN** the user hovers the folder header row
- **THEN** the folder leaf name SHALL show a hover affordance indicating the row navigates

## REMOVED Requirements

### Requirement: Sidebar open affordance

**Reason**: Superseded by "Requirement: Whole-row open affordance". The dedicated
`mdiOpenInNew` icon duplicated the destination of the header-row click, and it rendered only
on pinned or workspace-owned rows — present where the gesture is already learned, absent on
plain folder rows where it might have taught it. Sidebar navigation to `/folder/:encodedCwd`
remains fully specified by the whole-row requirement, which mandates that child controls stop
propagation and that navigation does not toggle the collapsed state.

**Migration**: The `folder-open-home-<cwd>` test id is removed. Automation navigating to a
directory home page from the sidebar SHALL activate the header row
(`folder-home-row-<cwd>`) instead. The folder name gains a hover affordance so the row reads
as a link.
