# pi-resources-view delta

## ADDED Requirements

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
- **THEN** the client POSTs `/api/resources/toggle` with `{ scope: "global", enabled: false }`
- **AND** `~/.pi/agent/settings.json#skills` gains a `-skills/my.md` force-exclude entry (relative to `~/.pi/agent`)
- **AND** no folder `.pi/settings.json` is written

#### Scenario: Re-enabling replaces the exclusion with a force-include
- **GIVEN** a settings file whose `extensions` array force-excludes `-extensions/my-ext.ts`
- **WHEN** the user enables that row
- **THEN** the client POSTs `/api/resources/toggle` with `{ enabled: true }`
- **AND** the `-extensions/my-ext.ts` entry is stripped and a `+extensions/my-ext.ts` force-include entry is written to that scope's `extensions` array (matching pi's own config format)

#### Scenario: Package-contributed resource toggled off never uninstalls the package
- **GIVEN** a scope with `packages: ["npm:pi-skills"]` contributing a skill `brave-search`
- **WHEN** the user disables the `brave-search` row
- **THEN** the client POSTs `/api/resources/toggle` with `{ enabled: false, packageSource: "npm:pi-skills" }`
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
