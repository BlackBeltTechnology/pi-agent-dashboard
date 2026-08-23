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

Activating a control SHALL issue `POST /api/resources/toggle` with `{ scope, cwd?, type, filePath, enabled, packageSource? }` and optimistically reflect the new state. The server SHALL persist via pi's `SettingsManager`, writing the pi-standard form for the resource's origin per the `cross-scope-resource-disable` capability:

- a loose resource under the toggled scope's own base directory uses a force-exclude pattern relative to that base directory — `relative(baseDir, filePath)`, exactly the pattern pi's own resolver and `config-selector` compute;
- a package-contributed resource at **local** scope uses an `autoload: false` delta entry in the project's `packages` array, carrying a force-exclude relative to the package root; at **global** scope it instead mutates the existing entry in place, adding an ordinary filter and no `autoload: false`, because pi discards a second same-scope entry for one package identity;
- a loose resource under a different scope's base directory uses a re-declaration of **its own file** plus a home-independent anchored glob exclusion.

Re-enabling SHALL remove the entries the disable added and SHALL NOT write a force-include.

A toggle the server cannot persist in a form pi will honour SHALL return a failure rather than a success, and a toggle in an untrusted folder SHALL return a trust prompt rather than a success.

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

#### Scenario: Global resource toggled off at folder scope survives a refresh
- **GIVEN** a global loose skill `~/.pi/agent/skills/image-to-3d-threejs/SKILL.md` browsed on the folder Resources surface
- **WHEN** the user disables its row
- **THEN** the folder's `.pi/settings.json#skills` gains that skill's own file entry and a home-independent exclusion for it
- **AND** `~/.pi/agent/settings.json` is not written
- **AND** the row still renders disabled after the surface is refreshed
- **AND** a session **newly started** in that folder from a terminal also treats the skill as disabled
- **AND** a collaborator resolving the same committed settings file under a different home directory also sees it disabled

#### Scenario: Re-enabling removes the exclusion
- **GIVEN** a settings file whose `extensions` array force-excludes `-extensions/my-ext.ts`
- **WHEN** the user enables that row
- **THEN** the client POSTs `/api/resources/toggle` with `{ scope: "local", type: "extension", filePath: "<abs>/.pi/extensions/my-ext.ts", enabled: true }`
- **AND** the `-extensions/my-ext.ts` entry is removed from that scope's `extensions` array
- **AND** no `+extensions/my-ext.ts` force-include entry is written

#### Scenario: Package-contributed resource toggled off never uninstalls the package
- **GIVEN** a scope with `packages: ["npm:pi-skills"]` contributing a skill `brave-search`
- **WHEN** the user disables the `brave-search` row
- **THEN** the client POSTs `/api/resources/toggle` with `{ scope: "local", type: "skill", filePath: "<abs>/skills/brave-search/SKILL.md", enabled: false, packageSource: "npm:pi-skills" }`
- **AND** the `pi-skills` package entry is rewritten to object-form excluding `brave-search` from its skills
- **AND** the `pi-skills` package remains installed

#### Scenario: Package declared only globally is disabled at folder scope
- **GIVEN** a folder whose own `settings.packages` does not declare `npm:pi-skills`, while `~/.pi/agent/settings.json` does
- **WHEN** the user disables the `brave-search` row on the folder Resources surface
- **THEN** the folder's `.pi/settings.json#packages` gains an `autoload: false` delta entry for `npm:pi-skills` excluding that skill
- **AND** the request does not fail with "package not found in settings for scope"
- **AND** the globally-declared `pi-skills` entry is not modified
- **AND** the package's other skills remain enabled

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

### Requirement: Skill cards SHALL carry a provenance badge

Provenance SHALL be conveyed by a per-card badge and a filter value, consistent with the flat card grid this capability already mandates. It SHALL NOT introduce stacked sections, groups, or nesting.

A skill card SHALL indicate one of: loaded by the session, present for this folder but not loaded, or loaded by the session from outside this folder.

#### Scenario: Active skill

- **GIVEN** a skill with status `active`
- **WHEN** the surface renders its card
- **THEN** no provenance badge SHALL be shown

#### Scenario: Loaded from outside this folder

- **GIVEN** a skill with status `loaded-elsewhere`
- **WHEN** the surface renders its card
- **THEN** the card SHALL carry a badge marking it as loaded by the session but not found for this folder
- **AND** the card SHALL show the path the session reported

#### Scenario: Present but not loaded

- **GIVEN** a skill with status `not-loaded`
- **WHEN** the surface renders its card
- **THEN** the card SHALL carry a badge marking it as present for this folder but not loaded

#### Scenario: Provenance does not introduce grouping

- **WHEN** cards of differing provenance are rendered
- **THEN** they SHALL remain in one flat grid
- **AND** no provenance section header, group header, or chevron SHALL be introduced

#### Scenario: Provenance is filterable

- **WHEN** the user narrows the grid by provenance
- **THEN** the grid SHALL show only cards carrying the selected provenance

### Requirement: A not-loaded card SHALL NOT assert an unverifiable cause

Because discovery already omits paths that fail pi's load gate, a skill reaching `not-loaded` status has a valid description by construction. The surface SHALL therefore report the status without asserting a cause.

#### Scenario: No cause is fabricated

- **GIVEN** a skill with status `not-loaded`
- **WHEN** the surface renders its card
- **THEN** it SHALL report only that the session did not load it
- **AND** it SHALL NOT assert a specific cause

#### Scenario: Differing session scope is surfaced

- **GIVEN** a `not-loaded` skill and a contributing session whose working directory differs from the scanned folder
- **WHEN** the surface renders the card
- **THEN** the differing working directory SHALL be shown as context

### Requirement: Scan-only and degraded states SHALL be visible rather than implied

When no session has reported, when several sessions have reported, or when the scan came from the degraded filesystem fallback, the surface SHALL say so and SHALL NOT present the list as a session's loaded skill set.

#### Scenario: Scan-only payload

- **GIVEN** a payload marked scan-only
- **WHEN** the surface renders the skills grid
- **THEN** it SHALL indicate that no single session is reporting skills
- **AND** no card SHALL display a `not-loaded` badge

#### Scenario: Degraded payload

- **GIVEN** a payload marked degraded because pi's resolver was unavailable or returned a contradicted empty result
- **WHEN** the surface renders the skills grid
- **THEN** it SHALL indicate that the list is a fallback and may not match the session
- **AND** no card SHALL display a `not-loaded` badge

### Requirement: Toggle failures SHALL be surfaced to the user

`useResourceActivation` SHALL, on any failed toggle, revert the optimistic flip **and** surface the failure reason to the user. A control that reverts with no explanation is indistinguishable from a control that does not work, which is how the underlying defect went unnoticed.

#### Scenario: A rejected toggle explains itself
- **GIVEN** a toggle the server rejects with a 400 and an error message
- **WHEN** the response is received
- **THEN** the control returns to its previous state
- **AND** the server's error message is presented to the user

#### Scenario: A network failure is distinguished from a rejection
- **GIVEN** the toggle request throws before a response is received
- **WHEN** the failure is handled
- **THEN** the control returns to its previous state
- **AND** the user is told the request did not reach the server

### Requirement: A resource whose activation the project has taken over SHALL remain where the user acted on it

Disabling a globally-defined resource at folder scope re-declares its file in project settings, which causes pi to report that resource at project scope rather than user scope. The surface SHALL NOT let the row silently relocate to a different scope section as a result of the user's own toggle.

#### Scenario: A disabled global resource stays in view
- **GIVEN** a global skill listed in the global section of the folder Resources surface
- **WHEN** the user disables it
- **THEN** the row remains in the section where the user acted
- **AND** it indicates that this folder now controls the resource's activation

#### Scenario: Re-enabling restores the original grouping
- **GIVEN** a global resource previously disabled at folder scope
- **WHEN** the user re-enables it
- **THEN** the row is grouped exactly as it was before the disable

### Requirement: The surface SHALL present a trust dialog when the folder is untrusted

When a toggle returns a trust-required result, the surface SHALL present the trust options the server supplied — trusting the folder, trusting its parent folder, or declining — rather than a generic error, and SHALL apply the original toggle once a choice is made.

#### Scenario: Untrusted folder raises a trust dialog
- **GIVEN** the folder Resources surface for a folder with no recorded trust decision
- **WHEN** the user disables a resource
- **THEN** a dialog presents the trust options supplied by the server
- **AND** the control does not yet show the resource as disabled

#### Scenario: Approving trust completes the original toggle
- **GIVEN** the trust dialog is open
- **WHEN** the user selects a trust option
- **THEN** the choice is persisted
- **AND** the resource the user originally toggled is disabled
- **AND** the dialog closes

#### Scenario: Dismissing the dialog reverts the control
- **GIVEN** the trust dialog is open
- **WHEN** the user dismisses it without choosing
- **THEN** the control returns to its previous state
- **AND** no settings or trust file is written

### Requirement: The surface SHALL state that a folder-scope disable is repository-wide

Because `.pi/settings.json` is tracked in version control, a folder-scope disable is a committed decision inherited by collaborators and by every worktree of the branch. The surface SHALL make this scope explicit rather than implying a machine-local preference.

#### Scenario: Folder scope communicates the shared blast radius
- **GIVEN** the folder Resources surface
- **WHEN** the user disables a resource
- **THEN** the surface indicates the change is written to the repository's `.pi/settings.json` and shared with anyone using the folder

### Requirement: Global and folder resource surfaces SHALL be one scope-switched surface

`/settings/{skills,agents,extensions,prompts,themes}` and `/folder/:cwd/settings/{skills,agents,extensions,prompts,themes}` render the same `ResourceGridPanel`, differing only in props: the global surface passes `scopes={["global"]}` with the scope filter hidden and routes file views to `/pi-resource`; the folder surface passes both scopes with the filter shown and routes file views to `/folder/:cwd/view`.

These ten route destinations SHALL collapse into one scope-switched surface. The surface SHALL derive its scope set, its scope-filter visibility, and its file-view target from the matched route rather than from a duplicated component tree. All ten paths SHALL continue to resolve and SHALL continue to render the resource type named in the path.

The two routes are never mounted simultaneously, so this is not a correctness defect — the justification is duplication cost alone: ten destinations maintaining one grid's wiring at two call sites, both of which this change already edits.

#### Scenario: Global resource path renders global scope only

- **WHEN** the user navigates to `/settings/skills`
- **THEN** the surface SHALL render the skills resource grid at global scope
- **AND** the scope filter SHALL NOT be shown

#### Scenario: Folder resource path renders both scopes with a filter

- **WHEN** the user navigates to `/folder/<encodedCwd>/settings/skills`
- **THEN** the surface SHALL render the skills resource grid across local and global scope
- **AND** the scope filter SHALL be shown

#### Scenario: File view target follows the matched scope

- **GIVEN** the user is on `/settings/skills`
- **WHEN** the user opens a resource file
- **THEN** the file view SHALL be routed to the global resource file path

#### Scenario: Folder file view target follows the folder scope

- **GIVEN** the user is on `/folder/<encodedCwd>/settings/skills`
- **WHEN** the user opens a resource file
- **THEN** the file view SHALL be routed to `/pi-resource?path=<path>&title=<title>`
- **AND** the target SHALL be identical from the global entry point: both entry
  points share ONE file-view route, which is what lets a single surface serve
  both scopes. (Corrected: an earlier draft of this scenario named a
  folder-scoped `/folder/:cwd/view` target that no implementation has ever
  used.)

#### Scenario: All ten resource paths still resolve

- **WHEN** each of `/settings/{skills,agents,extensions,prompts,themes}` and `/folder/<encodedCwd>/settings/{skills,agents,extensions,prompts,themes}` is opened
- **THEN** each SHALL render the resource type named in its path
- **AND** no path SHALL 404 or fall through to the card list

#### Scenario: One grid renders per matched route

- **GIVEN** a resource route is open as a route-backed overlay
- **WHEN** the surface renders
- **THEN** exactly one `ResourceGridPanel` SHALL be mounted for that route

