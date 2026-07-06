# directory-settings-page Specification

## Purpose
Defines the directory-scoped settings page: a cog-iconed surface at `/folder/:cwd/settings/:page?` mirroring the global settings left-nav + mobile hierarchy, with Instructions, Packages, and Resources pages (Packages default). Replaces the flat two-tab Pi Resources view.
## Requirements
### Requirement: Directory surface SHALL open as a settings page

The dashboard SHALL expose a route `/folder/:cwd/settings/:page?` that renders a directory-scoped settings page in the content area. The page SHALL present a left-nav (grouped, mirroring the global settings page) on wide viewports and SHALL degrade to the mobile settings hierarchy on narrow viewports. The valid pages SHALL be `instructions`, `packages`, and `resources`, with `packages` as the default when `:page?` is omitted.

The entry-point control on `FolderActionBar` SHALL use a cog icon (`mdiCog`) and the label "Directory Settings" (replacing the prior `mdiToyBrickOutline` icon and "Pi Resources" label).

#### Scenario: Cog button opens Directory Settings
- **GIVEN** a folder header for cwd `/Users/u/proj`
- **WHEN** the user clicks the cog "Directory Settings" button on `FolderActionBar`
- **THEN** the content area renders the directory settings page for `/Users/u/proj`
- **AND** the `packages` page is active by default
- **AND** the URL is `/folder/<encoded cwd>/settings/packages`

#### Scenario: Legacy pi-resources route redirects
- **GIVEN** an existing deep-link `/folder/<encoded cwd>/pi-resources`
- **WHEN** the user navigates to it
- **THEN** the app replace-redirects to `/folder/<encoded cwd>/settings/packages`
- **AND** the directory settings page renders with the `packages` page active

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

### Requirement: Instructions file selection SHALL be URL-encoded

On the Instructions page, selecting a file in the scoped file picker SHALL be a URL navigation, not React-only component state. Selecting a candidate SHALL push `/folder/:cwd/settings/instructions?file=<encoded relPath>` (global scope: `/settings/:page?...` equivalent) via history push. The active file SHALL be derived from the `?file=` query so the URL is the single source of truth for which file is shown.

Because each selection is a discrete history entry, the browser/OS back button and the shared depth-aware back action SHALL walk file→file→page→launcher rather than ejecting to the card list on the first back invocation. Selecting a file SHALL NOT change the settings route's depth (it remains depth 1).

When `?file=` is absent, the page SHALL apply its default selection. When `?file=` names a path not present in the current candidate set (e.g. deleted or out of scope after refresh), the page SHALL fall back to the default selection without error.

#### Scenario: Selecting a file pushes a history entry
- **GIVEN** the Instructions page is open at `/folder/<encoded cwd>/settings/instructions`
- **WHEN** the user picks `AGENTS.md` from the scoped picker
- **THEN** the URL SHALL become `/folder/<encoded cwd>/settings/instructions?file=AGENTS.md`
- **AND** a new browser history entry SHALL be created (push, not replace)
- **AND** the editor SHALL load `AGENTS.md`

#### Scenario: Back walks between selected files
- **GIVEN** the user selected `AGENTS.md` then `.pi/notes.md` on the Instructions page
- **WHEN** the user invokes the back action once
- **THEN** the URL SHALL return to `?file=AGENTS.md` and that file SHALL be shown
- **AND** the app SHALL NOT navigate to `/`

#### Scenario: Refresh restores the selected file
- **WHEN** the user refreshes at `/folder/<encoded cwd>/settings/instructions?file=AGENTS.md`
- **THEN** once candidates load, `AGENTS.md` SHALL be the active selection

#### Scenario: Unknown file falls back to default
- **WHEN** the page loads at `?file=does/not/exist.md` and no candidate matches
- **THEN** the page SHALL apply its default selection with no error

