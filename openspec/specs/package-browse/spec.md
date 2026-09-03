## Purpose

A reusable inline package browser used by the workspace card's Pi Resources → Packages tab and by Settings to install, update, search, and uninstall pi packages of every source shape (npm, local-path, git URL, file:// URL).
## Requirements
### Requirement: PackageBrowser component displays searchable package grid
The client SHALL provide a reusable `PackageBrowser` component that displays npm pi-packages in a searchable, filterable grid. It SHALL accept a `scope` prop ("global" or "local") and an optional `cwd` prop. The component SHALL render inline within the Settings panel or the Resources "Packages" tab. It SHALL include a text input for manually entering npm or git URLs for installation.

#### Scenario: Initial load
- **WHEN** the PackageBrowser mounts
- **THEN** it fetches packages from `/api/packages/search` and displays them as cards

#### Scenario: Search by text
- **WHEN** user types in the search input
- **THEN** the package list filters to matching results after a debounce delay

#### Scenario: Filter by type
- **WHEN** user clicks a type pill (extension/skill/theme/prompt)
- **THEN** only packages matching that type are shown

#### Scenario: Install from URL
- **WHEN** user pastes a source URL (e.g., `npm:@foo/bar` or `git:github.com/user/repo`) into the URL input and clicks Install
- **THEN** a confirmation dialog is shown and, upon confirm, the package is installed via `POST /api/packages/install`

### Requirement: Package cards show metadata and actions
Each package card SHALL display the package name, description, type badges, and weekly download count. Cards for already-installed packages SHALL show an "Installed" badge. Cards for not-installed packages SHALL show an "Install" button.

#### Scenario: Package not installed
- **WHEN** a package is not in the installed list
- **THEN** the card shows an "Install" button

#### Scenario: Package already installed
- **WHEN** a package is in the installed list
- **THEN** the card shows an "Installed" badge and an "Uninstall" button

### Requirement: README preview for packages
The PackageBrowser SHALL allow viewing a package's README in a dialog overlay. Clicking a package card SHALL fetch the README from `/api/packages/readme` and display it in a dialog with Install/Uninstall action and a close button.

#### Scenario: View README
- **WHEN** user clicks on a package card
- **THEN** the README is fetched and displayed in a dialog overlay with package name, version, and an action button

### Requirement: Install progress feedback
When a package install/remove/update is in progress, the UI SHALL show real-time progress received via WebSocket `package_progress` messages.

#### Scenario: Install with progress
- **WHEN** a confirmed install begins
- **THEN** a full-width Install button progress indicator appears showing streamed progress events until completion

#### Scenario: Install completes
- **WHEN** a `package_progress` event with `type: "complete"` arrives
- **THEN** the progress indicator disappears, the card updates to show "Installed" badge, and the installed packages list refreshes

### Requirement: Install requires confirmation
When a user initiates an install, the UI SHALL show a confirmation dialog displaying the package name, source, and target scope before proceeding.

#### Scenario: Confirm install
- **WHEN** user clicks Install on a package card or types a URL and clicks Install
- **THEN** a confirmation dialog shows the package name, source, and scope (global/local)
- **WHEN** user confirms
- **THEN** the install proceeds and a progress indicator appears showing streamed progress events

#### Scenario: Cancel install
- **WHEN** user clicks "Install" and then cancels the confirmation
- **THEN** no install occurs

### Requirement: Check for updates on demand
The installed packages list SHALL include a "Check for Updates" button. Clicking it SHALL call the server to check for available updates and mark packages that have updates available. No proactive polling or update badges.

#### Scenario: Check for updates
- **WHEN** user clicks "Check for Updates"
- **THEN** the server checks each installed package for available updates and returns which packages have updates

#### Scenario: Update available
- **WHEN** a package has an update available after checking
- **THEN** the package card shows an "Update Available" indicator and an "Update" button

### Requirement: Installed filter pill
The PackageBrowser SHALL include an "installed" toggle filter pill that shows only installed packages. When active, it SHALL merge search results with synthetic entries for installed packages not in search results.

#### Scenario: Toggle installed filter
- **WHEN** user clicks the "installed" filter pill
- **THEN** the package list shows only installed packages, merging search results with synthetic entries for installed packages not present in the search results

#### Scenario: Deactivate installed filter
- **WHEN** user clicks the active "installed" filter pill again
- **THEN** the package list returns to showing all search results

### Requirement: Cross-scope installation badges
Package cards SHALL show which scope(s) a package is installed in: "Global", "Local", or "Global + Local". The browser SHALL fetch both own-scope and other-scope installations.

#### Scenario: Package installed in single scope
- **WHEN** a package is installed only globally
- **THEN** the card shows a "Global" installation badge

#### Scenario: Package installed in both scopes
- **WHEN** a package is installed in both global and local scopes
- **THEN** the card shows a "Global + Local" installation badge

### Requirement: Per-card check for update
Each installed package card SHALL show a check-for-update button. Clicking it checks that specific package and shows an "Update" button if available.

#### Scenario: Check single package for update
- **WHEN** user clicks the check-for-update button on an installed package card
- **THEN** the server checks that specific package for available updates

#### Scenario: Update available for single package
- **WHEN** the check returns an available update for that package
- **THEN** the card shows an "Update" button that triggers `POST /api/packages/update` for that package

### Requirement: PackageBrowser SHALL render an Installed Packages section by default

The `PackageBrowser` component SHALL render a dedicated "Installed Packages" section above the search results when its `showInstalledSection` prop is `true` (the default). The section SHALL list every row returned by `useInstalledPackages(scope, cwd)` whose `isRecommended === false` (recommended ones already render in the existing `RecommendedExtensions` panel). Each row SHALL be a `PackageRow` and SHALL display source-type badges via `classifySource(pkg.source)`. The section SHALL render the same way regardless of source shape — `npm:`, absolute path, relative path, `file://`, `git://`, `https://...git`, and bare git URLs all SHALL produce a row with `Update` and `Uninstall` actions.

When `showInstalledSection` is `false`, the component SHALL NOT render the Installed Packages section. This case applies in Settings → Packages, where `UnifiedPackagesSection` (Pi Ecosystem) is the canonical global-scope manage surface and rendering both would duplicate every installed row.

#### Scenario: npm-source row in workspace scope

- **WHEN** the workspace `<cwd>/.pi/settings.json` has `packages: ["npm:pi-flows"]`
- **THEN** `PackageBrowser` renders a `PackageRow` with `source="npm:pi-flows"` and `sourceType="npm"`
- **AND** the row exposes `Update` and `Uninstall` buttons

#### Scenario: local-path row in workspace scope

- **WHEN** the workspace `<cwd>/.pi/settings.json` has `packages: ["/abs/path/my-ext"]`
- **THEN** `PackageBrowser` renders a `PackageRow` with `source="/abs/path/my-ext"` and `sourceType="local"`
- **AND** the row exposes a working `Uninstall` button

#### Scenario: git-source row in workspace scope

- **WHEN** the workspace `<cwd>/.pi/settings.json` has `packages: ["git@github.com:user/repo.git"]`
- **THEN** `PackageBrowser` renders a `PackageRow` with `sourceType="git"`
- **AND** the row exposes a working `Uninstall` button

#### Scenario: empty installed list does not render the section header

- **WHEN** the workspace settings.json `packages[]` is empty
- **AND** there are no recommended extensions installed
- **THEN** `PackageBrowser` does not render the "Installed Packages" section header (no empty heading)
- **AND** the search-results area renders normally

#### Scenario: showInstalledSection={false} suppresses the section even when packages exist

- **WHEN** `PackageBrowser` is mounted with `showInstalledSection={false}` and the scope has installed packages
- **THEN** the Installed Packages section header is NOT rendered
- **AND** no `PackageRow` for any installed package is rendered
- **AND** Settings → Packages relies on `UnifiedPackagesSection` (Pi Ecosystem) above to manage these rows

### Requirement: Uninstall and update calls SHALL pass `pkg.source` verbatim

When a `PackageRow` in the Installed Packages section invokes `onUninstall` or `onUpdate`, the client SHALL call `operations.remove(pkg.source)` or `operations.update(pkg.source)` with the original `pkg.source` string from the server's `InstalledPackage` row. The client SHALL NOT regex-extract an npm name, prepend an `npm:` prefix, or otherwise reshape the source.

#### Scenario: local-path uninstall uses raw source

- **WHEN** the user clicks `Uninstall` on a row whose `pkg.source === "/home/me/my-ext"`
- **THEN** the client invokes `operations.remove("/home/me/my-ext")` (the original path string)
- **AND** the corresponding `POST /api/packages/remove` body has `{ source: "/home/me/my-ext", scope, cwd }`

#### Scenario: git-source update uses raw source

- **WHEN** the user clicks `Update` on a row whose `pkg.source === "git@github.com:user/repo.git"`
- **THEN** the client invokes `operations.update("git@github.com:user/repo.git")`

### Requirement: Cross-scope installed badges SHALL be keyed by `source`

The `PackageBrowser`'s `installedInfo` map SHALL be keyed by `pkg.source` (the canonical source string from the server). Cross-scope detection SHALL work for every source shape, not only `npm:<name>`. The npm-name regex extraction at `PackageBrowser.tsx:35-49` (pre-change) SHALL be removed.

#### Scenario: local-path installed in both scopes shows cross-scope badge

- **WHEN** the workspace settings.json has `packages: ["/abs/path/foo"]`
- **AND** the global settings.json also has `packages: ["/abs/path/foo"]`
- **AND** the user is viewing `PackageBrowser` with `scope="local"`
- **THEN** the `/abs/path/foo` row shows a "also installed in global" badge

#### Scenario: search-result row for a package installed in workspace shows local-scope badge

- **WHEN** the user searches `npm` and a result for `pi-flows` appears
- **AND** `pi-flows` is installed in the workspace (`source === "npm:pi-flows"`)
- **THEN** the search-result `PackageCard` shows the "installed locally" badge using a synthesized `npm:${pkg.name}` lookup against the source-keyed map

### Requirement: PackageBrowser SHALL NOT render an "Installed" filter pill

The previous "Installed" filter pill in the type-filter row SHALL be removed. The Installed Packages section above replaces its function. No control SHALL exist for filtering the search results to installed packages only.

#### Scenario: Filter pill is absent

- **WHEN** `PackageBrowser` renders
- **THEN** no `data-testid="package-installed-filter"` element exists
- **AND** the type-filter row contains only the four type pills (extension/skill/theme/prompt)

#### Scenario: Synthetic-installed-card path is removed

- **WHEN** a non-npm package (e.g. `/abs/path/foo`) is installed
- **THEN** no synthetic `PackageCard` is rendered for it in the search-results grid
- **AND** the package appears only in the Installed Packages section (as a `PackageRow`)

