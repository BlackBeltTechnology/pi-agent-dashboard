## MODIFIED Requirements

### Requirement: Directory surface SHALL open as a settings page

The dashboard SHALL expose a route `/folder/:cwd/settings/:page?` that renders a directory-scoped settings page in the content area. The page SHALL present a left-nav (grouped, mirroring the global settings page) on wide viewports and SHALL degrade to the mobile settings hierarchy on narrow viewports. The valid pages SHALL be `instructions`, `add-ons`, `cards` and the resource pages, with `add-ons` as the default when `:page?` is omitted. The legacy page id `packages` SHALL replace-redirect to `add-ons`.

The entry-point control SHALL be an item in the folder actions menu, under the directory group, using a cog icon (`mdiCog`) and the label "Directory Settings". It SHALL NOT render as a control on the directory card itself — neither on the git row nor in the tier-0 banner.

#### Scenario: Menu item opens Directory Settings

- **GIVEN** a folder header for cwd `/Users/u/proj`
- **WHEN** the user opens the folder actions menu and activates the "Directory Settings" item
- **THEN** the client SHALL navigate to that directory's settings route
- **AND** the `add-ons` page SHALL render by default

#### Scenario: No settings cog remains on the card

- **WHEN** an expanded folder card renders
- **THEN** no Directory Settings cog SHALL render on the git row or in the banner

#### Scenario: Legacy pi-resources route redirects

- **GIVEN** an existing deep-link `/folder/<encoded cwd>/pi-resources`
- **WHEN** the user navigates to it
- **THEN** the app replace-redirects to `/folder/<encoded cwd>/settings/add-ons`
- **AND** the directory settings page renders with the `add-ons` page active

#### Scenario: Legacy packages page id redirects

- **GIVEN** an existing deep-link `/folder/<encoded cwd>/settings/packages`
- **WHEN** the user navigates to it
- **THEN** the app replace-redirects to `/folder/<encoded cwd>/settings/add-ons`
- **AND** no extra browser-history entry SHALL be added

### Requirement: Packages and Resources SHALL be pages, not co-equal tabs

The `Add-ons` page (page id `add-ons`, formerly `Packages`) SHALL render within the directory settings left-nav and retain the existing workspace-scope manage surface. Rows flagged `dashboardManaged` SHALL NOT render on it. The former single `Resources` page SHALL be replaced by a `RESOURCES` nav group exposing one dedicated page per resource type — **Skills, Agents, Extensions, Prompts, Themes** — each rendering a responsive **card grid** (not a collapsible tree). No combined/aggregate `Resources` page SHALL remain.

Each per-type page SHALL render the resources of that type across both local and global scope as cards. Each card SHALL surface, as explicit card content rather than by tree position: the resource **scope** (`local`/`global` badge), its **source** (`loose` badge, or a `📦 <package-name>` badge for a package-contributed resource), the resource **file path**, and the existing per-resource **activation toggle**. A card SHALL open the file preview when clicked. The page SHALL provide a name/description **search filter** and an `All / Local / Global` **scope filter**.

The `DirectorySettingsPage` union SHALL enumerate `instructions`, `add-ons`, `cards`, `skills`, `agents`, `extensions`, `prompts`, `themes` and SHALL NOT include `resources` or `packages`. Every page in the union SHALL be addressable by URL.

#### Scenario: Packages page preserves manage surface
- **GIVEN** the directory settings page is open
- **WHEN** the user selects the `Add-ons` page
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
