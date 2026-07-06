## Purpose

The Pi Resources view is the workspace's content-area surface for browsing every pi-resource (skill, extension, prompt) available to a session — loose files in `<cwd>/.pi/` and `~/.pi/agent/` plus the resources contributed by installed packages — and for managing the workspace's installed packages.
## Requirements
### Requirement: Folder header navigation button
The sidebar folder header SHALL include a button to navigate to the Pi Resources view.

#### Scenario: Button presence
- **WHEN** a folder group is rendered in the sidebar
- **THEN** a Pi Resources button SHALL appear in the button row alongside [+ Session] and [+ Terminal]

#### Scenario: Button click
- **WHEN** the user clicks the Pi Resources button
- **THEN** the content area SHALL display the PiResourcesView for that folder's cwd

### Requirement: PiResourcesView content area
The dashboard SHALL display a PiResourcesView in the main content area.

#### Scenario: View layout
- **WHEN** the PiResourcesView is displayed
- **THEN** it SHALL show a header with back button and folder path
- **AND** resources SHALL be grouped into "Local", "Global", and "Packages" sections

#### Scenario: Back navigation
- **WHEN** the user clicks the back button in PiResourcesView
- **THEN** the view SHALL close and return to the previous content (chat or session view)

#### Scenario: Empty section display
- **WHEN** a scope section (local/global) has no resources of any type
- **THEN** the section SHALL display "(none)" instead of empty lists

#### Scenario: Skills display
- **WHEN** skills are present in a scope
- **THEN** each skill SHALL display its name and description (truncated if long)
- **AND** each skill SHALL have a "View" action

#### Scenario: Prompts display
- **WHEN** prompts are present in a scope
- **THEN** each prompt SHALL display its name (filename without .md) and description
- **AND** each prompt SHALL have a "View" action

#### Scenario: Extensions display
- **WHEN** extensions are present in a scope
- **THEN** each extension SHALL display its name (filename) and source info
- **AND** each extension SHALL have a "View" action

#### Scenario: Package display
- **WHEN** packages are present
- **THEN** each package SHALL show its name, source type (npm/git/local), and description
- **AND** each package's resources SHALL be listed beneath it

### Requirement: File preview navigation (stack)
Clicking "View" on a resource SHALL push a file preview onto the navigation stack.

#### Scenario: View markdown resource
- **WHEN** the user clicks "View" on a skill (SKILL.md) or prompt (.md)
- **THEN** the MarkdownPreviewView SHALL be shown with the file content rendered as markdown
- **AND** the back button SHALL return to PiResourcesView (not to chat)

#### Scenario: View TypeScript resource
- **WHEN** the user clicks "View" on an extension (.ts)
- **THEN** the MarkdownPreviewView SHALL be shown with the file content displayed as a code block

#### Scenario: Stack depth
- **WHEN** the user is in file preview (depth 2)
- **AND** clicks back
- **THEN** the PiResourcesView (depth 1) SHALL be shown
- **WHEN** the user clicks back again
- **THEN** the chat view (depth 0) SHALL be shown

### Requirement: Resource file reading
The client SHALL fetch resource files via a server endpoint.

#### Scenario: Read local resource
- **WHEN** "View" is clicked on a local resource
- **THEN** the client SHALL request the file via `GET /api/pi-resource-file?path=<absolutePath>`

#### Scenario: Read global resource
- **WHEN** "View" is clicked on a global resource (e.g., `~/.pi/agent/skills/foo/SKILL.md`)
- **THEN** the client SHALL request the file via `GET /api/pi-resource-file?path=<absolutePath>`

#### Scenario: Read package resource
- **WHEN** "View" is clicked on a package resource
- **THEN** the client SHALL request the file via `GET /api/pi-resource-file?path=<absolutePath>`

### Requirement: Periodic client polling
The client SHALL poll the server for pi resources data.

#### Scenario: Polling interval
- **WHEN** the PiResourcesView is open or a folder's resources have been fetched
- **THEN** the client SHALL poll `GET /api/pi-resources?cwd=...` every 30 seconds

#### Scenario: Loading state
- **WHEN** the initial fetch is in progress
- **THEN** the PiResourcesView SHALL show a loading indicator

#### Scenario: Error state
- **WHEN** the fetch fails
- **THEN** the PiResourcesView SHALL show an error message with retry option

### Requirement: Mobile support
The PiResourcesView SHALL work on mobile using MobileShell patterns.

#### Scenario: Mobile navigation
- **WHEN** the user navigates to PiResourcesView on mobile
- **THEN** it SHALL render as a full-screen panel with slide transition
- **AND** swipe-back gesture SHALL return to the previous view

### Requirement: Pi Resources button icon
The Pi Resources button in the folder action bar SHALL use `mdiToyBrickOutline` (or `mdiPackageVariantClosed`) from the MDI icon set instead of `mdiPuzzleOutline`.

#### Scenario: Icon displayed
- **WHEN** the folder action bar is rendered
- **THEN** the Pi Resources button SHALL display the updated icon
- **THEN** the button SHALL retain its right-aligned position in the action bar

### Requirement: Resources view shows installed pi resources for a workspace
The PiResourcesView SHALL include a tab bar with "Installed" (existing view) and "Packages" (new) tabs. The "Packages" tab SHALL display the PackageBrowser in local scope, showing installed local packages and allowing search/install/remove/update for the workspace's `.pi/settings.json`.

#### Scenario: Switch to Packages tab
- **WHEN** user clicks the "Packages" tab in PiResourcesView
- **THEN** the PackageBrowser is shown in local scope for the current workspace cwd

#### Scenario: Install local package
- **WHEN** user clicks "Install" on a package in the Packages tab
- **THEN** the package is installed via `POST /api/packages/install` with `scope: "local"` and the workspace cwd

#### Scenario: Default tab is Installed
- **WHEN** user opens PiResourcesView
- **THEN** the "Installed" tab is selected by default showing the existing resources view

### Requirement: Merged scope sections

The resource browse surface SHALL NOT render Local/Global as stacked collapsible
sections. Resources SHALL instead be presented per type (Skills, Agents,
Extensions, Prompts, Themes) as a flat card grid, with **scope** conveyed by a
per-card `local`/`global` badge rather than by which section a row sits in. On a
surface that spans both scopes (Directory Settings), an `All / Local / Global`
segmented filter SHALL narrow the grid by the card scope badge.

#### Scenario: Scope shown per card, not per section
- **WHEN** the user views a resource type page for a workspace with local and global resources of that type
- **THEN** all resources SHALL render as cards in one grid
- **AND** each card SHALL carry a `local` or `global` scope badge
- **AND** there SHALL be no stacked "Local" / "Global" section headers

#### Scenario: Scope filter replaces scope sections
- **WHEN** the user selects the `Global` scope filter on a type page
- **THEN** only cards with a `global` scope badge SHALL remain visible

### Requirement: Collapsible resource hierarchy

The resource browse surface SHALL render resources as a flat card grid rather
than a collapsible chevron tree. There SHALL be no section/group/package chevron
toggles and no depth-based indentation for browsing resources. Package
provenance SHALL be conveyed by a per-card `📦 <package-name>` source badge
rather than by nesting resources under a collapsible package row.

#### Scenario: No chevron tree
- **WHEN** a resource type page loads
- **THEN** resources SHALL render as cards immediately (no collapsed groups to expand)
- **AND** no chevron toggle SHALL gate their visibility

#### Scenario: Package provenance is a badge, not nesting
- **GIVEN** a package `pi-flows` contributes skills to the workspace
- **WHEN** the user views the Skills page
- **THEN** each contributed skill SHALL render as its own card with a `📦 pi-flows` badge
- **AND** the skills SHALL NOT be nested under a collapsible `📦 pi-flows` row

### Requirement: Resources tab SHALL be a pure browse surface

The first tab in `PiResourcesView` SHALL be labeled "Resources" (rendered text). Its purpose SHALL be to browse pi-resource files (skills, extensions, prompts) loose in `<cwd>/.pi/` or `~/.pi/agent/`, plus the resources contributed by each installed package. The tab SHALL NOT render standalone manage rows for installed packages (no "uninstall" buttons, no version pills, no source-type badges at the top level). Per-package nested resource trees SHALL remain (a 📦 collapsible whose children are the Skills/Extensions/Prompts the package contributes).

The internal route id SHALL remain `"installed"` to preserve existing test selectors and route deep-links; only the rendered label and `data-testid`s change.

#### Scenario: Tab label reads "Resources"

- **WHEN** `PiResourcesView` renders its tab bar
- **THEN** the first tab's visible text is `"Resources"` (not `"Installed"`)
- **AND** the second tab's text remains `"Packages"`

#### Scenario: Loose `.pi/` files render under their scope

- **WHEN** `<cwd>/.pi/skills/foo/SKILL.md`, `<cwd>/.pi/extensions/bar.ts`, and `<cwd>/.pi/prompts/baz.md` exist
- **THEN** the Resources tab's "Local" section renders a `Skills (1)` group, an `Extensions (1)` group, and a `Prompts (1)` group
- **AND** each entry is clickable (opens the file in the content area)
- **AND** no entry has an Uninstall button

#### Scenario: Per-package nested resource trees render

- **WHEN** the workspace has `packages: ["npm:pi-flows"]` installed
- **AND** `pi-flows` contributes 4 skills and 2 extensions to the session
- **THEN** the Resources tab's "Local" section renders a 📦 `pi-flows` collapsible
- **AND** expanding it reveals `Skills (4)` and `Extensions (2)` sub-groups
- **AND** clicking an individual skill/extension opens the file (read-only)
- **AND** the 📦 row has no Uninstall button (manage actions live in the Packages tab)

#### Scenario: Installed package with no contributed resources still renders nothing standalone

- **WHEN** the workspace has `packages: ["/abs/path/library-only"]` installed
- **AND** `library-only` contributes zero skills/extensions/prompts
- **THEN** the Resources tab does NOT render a 📦 row for `library-only`
- **AND** the package still appears with full management UI in the Packages tab

### Requirement: Packages tab SHALL be the only workspace-scope manage surface

The Packages tab in `PiResourcesView` SHALL host the workspace-scope install / update / uninstall workflow. It SHALL render `PackageBrowser` with `scope="local"` and `cwd={folderCwd}`. The tab SHALL be discoverable to users who installed a non-npm package and want to remove it (via the Installed Packages section described in the `package-browse` spec).

#### Scenario: Packages tab is the sole workspace-scope uninstall path

- **WHEN** the workspace has a local-path package installed (`/home/me/my-ext`)
- **THEN** the Packages tab's Installed Packages section renders a `PackageRow` for it with an `Uninstall` button
- **AND** the Resources tab does not render a manage row for it
- **AND** clicking `Uninstall` issues `POST /api/packages/remove { source: "/home/me/my-ext", scope: "local", cwd }`

### Requirement: Installed tab renders unified package list
The Pi Resources view's "Installed" (Resources) tab SHALL render packages using the shared `<InstalledPackagesList>` component alongside the loose-resource tree from `<MergedScopeSection>`.

The tab SHALL contain, for each scope (Local and Global), in vertical order:

1. A loose Skills / Extensions / Prompts tree showing resources that exist on disk but are NOT contributed by any installed package (rendered by `<MergedScopeSection>`).
2. A "Packages" sub-heading followed by `<InstalledPackagesList scope=<scope> cwd=<view's cwd or undefined> />`.

The loose section SHALL preserve its tree rendering. The Packages section SHALL render rich rows (`<PackageRow>`) consistent with Settings → Packages.

Each rich row SHALL:

- Display version, update badge, progress, errors, and source-type badge identically to Settings.
- Expose `Update`, `Uninstall`, `View README`, and (when applicable) `Move →` actions.
- Provide an expand-chevron that reveals an inline tree of skills / extensions / prompts contributed by this package, populated from `usePiResources` data via the `containedResources` prop.

#### Scenario: Local packages render as rich rows
- **WHEN** the user opens Pi Resources for `/abs/cwd`
- **AND** `/abs/cwd/.pi/settings.json` lists 2 packages
- **THEN** the Local section's "Packages" sub-heading SHALL be followed by an `<InstalledPackagesList scope="local" cwd="/abs/cwd">` rendering 2 rich rows
- **AND** each row SHALL show version, update badge, and the action buttons

#### Scenario: Loose resources still render as tree
- **GIVEN** `/abs/cwd/.pi/skills/foo/SKILL.md` exists but `foo` is not contributed by any installed package
- **THEN** the Local section's loose Skills group SHALL list `foo`
- **AND** `foo` SHALL NOT appear inside any package row's expand tree

#### Scenario: Expanding a package reveals contained resources
- **GIVEN** `pi-flows` package contributes 1 skill, 2 extensions, 1 prompt
- **WHEN** the user clicks the row's expand chevron
- **THEN** an inline tree SHALL render listing those 4 resources, grouped by type
- **AND** clicking a leaf SHALL navigate to the resource's file preview

### Requirement: Installed tab move action wires to /api/packages/move
Each package row in the Pi Resources Installed tab SHALL display a `Move →` menu action in addition to existing actions, except when the destination scope already contains the same package identity (in which case the action SHALL be disabled with an explanatory tooltip).

When activated:

- A row in the **Local** list SHALL invoke `move(entry, { fromScope: "local", fromCwd: <view's cwd>, toScope: "global" })` with no further user input.
- A row in the **Global** list SHALL invoke `move(entry, { fromScope: "global", toScope: "local", toCwd: <view's cwd> })` because the cwd is implicit from the surface.

#### Scenario: Move from Local to Global
- **GIVEN** `npm:pi-flows` is installed at scope=local in `/abs/cwd`
- **WHEN** the user clicks `Move → Global` on its row
- **THEN** the client POSTs `/api/packages/move` with `{ entry: <full entry from local settings>, fromScope: "local", fromCwd: "/abs/cwd", toScope: "global" }`
- **AND** the row shows a single composite progress affordance tied to the returned `moveId`
- **AND** on success the row disappears from the Local list and appears in the Global list

#### Scenario: Move from Global to Local
- **WHEN** the user clicks `Move → Local` on a row in the Global list
- **THEN** the client POSTs `/api/packages/move` with `toScope: "local", toCwd: <view's cwd>`
- **AND** no folder picker is shown (cwd is implicit from the surface)

#### Scenario: Move disabled when already at destination
- **GIVEN** `npm:pi-flows` is installed at both scopes
- **WHEN** the row renders in the Local list
- **THEN** the `Move → Global` button SHALL be disabled
- **AND** its tooltip SHALL read `Already installed in global scope`

### Requirement: Resources surface SHALL expose a per-resource activation toggle at both scopes

The Resources surface of `PiResourcesView` (rendered on both the folder settings page and the global settings page) SHALL render, on each browsed extension / skill / prompt row, an enable/disable control bound to `PiResource.enabled`. The control SHALL flip activation only for its scope (local → the folder's `.pi/settings.json`; global → `~/.pi/agent/settings.json`); it SHALL NOT install, uninstall, move, or delete any resource or package. Installation management SHALL remain exclusively on the Packages tab / section.

Activating a control SHALL issue `POST /api/resources/toggle` with `{ scope, cwd?, type, filePath, enabled, packageSource? }` and optimistically reflect the new state. The server SHALL persist via pi's `SettingsManager` using pi's own format: strip any existing entry for the resource's relative-path pattern, then push `-<relPath>` (disable) or `+<relPath>` (enable). `<relPath>` is `relative(baseDir, filePath)` where `baseDir` is the scope's config dir (`.pi` for local, `~/.pi/agent` for global) or, for a package resource, the package root — exactly the pattern pi's own resolver + `config-selector` compute.

#### Scenario: Loose extension toggled off at folder scope persists an exclusion
- **GIVEN** a folder with a loose extension `.pi/extensions/my-ext.ts` and no exclusion for it in `.pi/settings.json`
- **WHEN** the user disables its row on the folder Resources surface
- **THEN** the client POSTs `/api/resources/toggle` with `{ scope: "local", type: "extension", filePath: "<abs>/.pi/extensions/my-ext.ts", enabled: false }`
- **AND** the folder's `.pi/settings.json#extensions` gains a `-extensions/my-ext.ts` force-exclude entry (relative to `.pi`)
- **AND** the row renders in the disabled state

#### Scenario: Loose resource toggled off at global scope writes the global settings file
- **GIVEN** a global loose skill `~/.pi/agent/skills/my.md` with no exclusion
- **WHEN** the user disables its row on the global settings Resources surface
- **THEN** the client POSTs `/api/resources/toggle` with `{ scope: "global", type: "skill", filePath: "<abs>/.pi/agent/skills/my.md", enabled: false }` (no `cwd` for global scope)
- **AND** `~/.pi/agent/settings.json#skills` gains a `-skills/my.md` force-exclude entry (relative to `~/.pi/agent`)
- **AND** no folder `.pi/settings.json` is written

#### Scenario: Re-enabling replaces the exclusion with a force-include
- **GIVEN** a settings file whose `extensions` array force-excludes `-extensions/my-ext.ts`
- **WHEN** the user enables that row
- **THEN** the client POSTs `/api/resources/toggle` with `{ scope: "local", type: "extension", filePath: "<abs>/.pi/extensions/my-ext.ts", enabled: true }`
- **AND** the `-extensions/my-ext.ts` entry is stripped and a `+extensions/my-ext.ts` force-include entry is written to that scope's `extensions` array (matching pi's own config format)

#### Scenario: Package-contributed resource toggled off never uninstalls the package
- **GIVEN** a scope with `packages: ["npm:pi-skills"]` contributing a skill `brave-search`
- **WHEN** the user disables the `brave-search` row
- **THEN** the client POSTs `/api/resources/toggle` with `{ scope: "local", type: "skill", filePath: "<abs>/skills/brave-search/SKILL.md", enabled: false, packageSource: "npm:pi-skills" }`
- **AND** the `pi-skills` package entry is rewritten to object-form excluding `brave-search` from its skills
- **AND** the `pi-skills` package remains installed

#### Scenario: Resources surface still exposes no install/uninstall control
- **GIVEN** the Resources surface is open for a scope with installed packages
- **WHEN** it renders
- **THEN** no row exposes an Install, Uninstall, Update, or Move action
- **AND** the only per-resource manage control is the activation toggle

### Requirement: A toggle SHALL offer a one-click reload of affected sessions

Because pi reads resource arrays at session start, running sessions are unaffected until reloaded. After any toggle, the Resources surface SHALL present a one-click "Reload N sessions" control, where N is the count of running sessions governed by the toggled scope (from the toggle response's `affectedSessions`). The control SHALL reuse the existing session-reload machinery (`package-manager-wrapper` `reloadSessions()` / per-session `/reload`), not introduce a new reload mechanism.

#### Scenario: Reload button reloads only the folder's sessions for a local toggle
- **GIVEN** a folder toggle just completed and the folder has 2 running sessions
- **WHEN** the "Reload 2 sessions" button is shown and clicked
- **THEN** the client POSTs `/api/resources/reload` with `{ scope: "local", cwd }`
- **AND** only that folder's running sessions are reloaded
- **AND** the pending-reload state clears on success

#### Scenario: Reload button reloads all sessions for a global toggle
- **GIVEN** a global toggle just completed with 3 running sessions across folders
- **WHEN** the "Reload 3 sessions" button is clicked
- **THEN** the client POSTs `/api/resources/reload` with `{ scope: "global" }`
- **AND** all running sessions are reloaded

#### Scenario: No running sessions hides the reload control
- **GIVEN** a toggle just completed and no sessions are running in the toggled scope
- **WHEN** the surface re-renders
- **THEN** N is 0 and no reload control is shown

### Requirement: Scanned resources SHALL report scope-derived activation state

`GET /api/pi-resources?cwd=<cwd>` (via `pi-resource-scanner`) SHALL set `enabled` on every returned `PiResource` in both the `local` and `global` result sets, sourced from pi's own resolver (`PackageManager.resolve()` → `ResolvedResource.enabled`) rather than a re-implemented glob engine. A resource pi does not report SHALL default to `enabled: true`.

#### Scenario: Unmatched resource defaults to enabled
- **GIVEN** a folder with a loose skill `.pi/skills/notes.md` and no resource-array rule referencing it
- **WHEN** the resources are scanned for that cwd
- **THEN** the returned `PiResource` for `notes` has `enabled: true`

#### Scenario: Force-excluded resource reports disabled
- **GIVEN** a folder with a loose skill `.pi/skills/notes.md` whose `.pi/settings.json#skills` contains `-skills/notes.md`
- **WHEN** the resources are scanned for that cwd
- **THEN** the returned `PiResource` for `notes` has `enabled: false`

