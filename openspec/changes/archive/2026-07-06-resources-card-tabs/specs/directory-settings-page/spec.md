## MODIFIED Requirements

### Requirement: Packages and Resources SHALL be pages, not co-equal tabs

The `Packages` page SHALL render within the directory settings left-nav and
retain the existing workspace-scope manage surface. The former single
`Resources` page SHALL be replaced by a `RESOURCES` nav group exposing one
dedicated page per resource type — **Skills, Agents, Extensions, Prompts,
Themes** — each rendering a responsive **card grid** (not a collapsible tree).
No combined/aggregate `Resources` page SHALL remain.

Each per-type page SHALL render the resources of that type across both local and
global scope as cards. Each card SHALL surface, as explicit card content rather
than by tree position: the resource **scope** (`local`/`global` badge), its
**source** (`loose` badge, or a `📦 <package-name>` badge for a
package-contributed resource), the resource **file path**, and the existing
per-resource **activation toggle**. A card SHALL open the file preview when
clicked. The page SHALL provide a name/description **search filter** and an
`All / Local / Global` **scope filter**.

The `DirectorySettingsPage` union SHALL enumerate `skills`, `agents`,
`extensions`, `prompts`, `themes` and SHALL NOT include `resources`.

#### Scenario: Packages page preserves manage surface
- **GIVEN** the directory settings page is open
- **WHEN** the user selects the `packages` page
- **THEN** the workspace-scope package manage surface renders (install/update/uninstall actions intact)

#### Scenario: Resources group exposes per-type pages
- **WHEN** the directory settings left-nav renders
- **THEN** a `RESOURCES` group SHALL list `Skills`, `Agents`, `Extensions`, `Prompts`, `Themes`
- **AND** there SHALL be no combined `Resources` nav item

#### Scenario: A type page renders cards, not a tree
- **GIVEN** the workspace has local and global skills, some contributed by a package `pi-flows`
- **WHEN** the user selects the `Skills` page
- **THEN** each skill SHALL render as a card
- **AND** a package-contributed skill's card SHALL show a `📦 pi-flows` source badge
- **AND** a local skill's card SHALL show a `local` scope badge
- **AND** no collapsible tree rows SHALL be rendered

#### Scenario: Scope filter narrows the grid
- **GIVEN** the `Skills` page shows local and global skill cards
- **WHEN** the user selects the `Local` scope filter
- **THEN** only cards with a `local` scope badge SHALL remain visible

#### Scenario: Navigating between type pages updates the URL
- **GIVEN** the directory settings page is open at `…/settings/skills`
- **WHEN** the user selects the `Agents` page from the left-nav
- **THEN** the URL becomes `…/settings/agents`
- **AND** the agent card grid renders
