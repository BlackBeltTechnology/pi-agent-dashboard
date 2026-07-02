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

The prior `Resources` and `Packages` tabs of `PiResourcesView` SHALL render as pages within the directory settings left-nav. The `Packages` page SHALL retain the existing workspace-scope manage surface. The `Resources` page SHALL retain the existing browse-only resource listing.

#### Scenario: Packages page preserves manage surface
- **GIVEN** the directory settings page is open
- **WHEN** the user selects the `packages` page
- **THEN** the workspace-scope package manage surface renders (install/update/uninstall actions intact)

#### Scenario: Navigating between pages updates the URL
- **GIVEN** the directory settings page is open at `…/settings/packages`
- **WHEN** the user selects the `resources` page from the left-nav
- **THEN** the URL becomes `…/settings/resources`
- **AND** the resources listing renders


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
