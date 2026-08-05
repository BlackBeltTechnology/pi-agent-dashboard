## MODIFIED Requirements

### Requirement: Resources surface SHALL expose a per-resource activation toggle at both scopes

The Resources surface of `PiResourcesView` (rendered on both the folder settings page and the global settings page) SHALL render, on each browsed extension / skill / prompt row, an enable/disable control bound to `PiResource.enabled`. The control SHALL flip activation only for its scope (local → the folder's `.pi/settings.json`; global → `~/.pi/agent/settings.json`); it SHALL NOT install, uninstall, move, or delete any resource or package. Installation management SHALL remain exclusively on the Packages tab / section.

Activating a control SHALL issue `POST /api/resources/toggle` with `{ scope, cwd?, type, filePath, enabled, packageSource? }` and optimistically reflect the new state. The server SHALL persist via pi's `SettingsManager`, writing the pi-standard form for the resource's origin per the `cross-scope-resource-disable` capability:

- a loose resource under the toggled scope's own base directory uses a force-exclude pattern relative to that base directory — `relative(baseDir, filePath)`, exactly the pattern pi's own resolver and `config-selector` compute;
- a package-contributed resource uses an `autoload: false` delta entry in the scope's `packages` array, carrying a force-exclude relative to the package root;
- a loose resource under a different scope's base directory uses a re-declaration of its containing directory plus a force-exclude by absolute path.

A toggle the server cannot persist in a form pi will honour SHALL return a failure rather than a success.

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
- **THEN** the folder's `.pi/settings.json#skills` gains the containing directory entry and an absolute force-exclude for that file
- **AND** `~/.pi/agent/settings.json` is not written
- **AND** the row still renders disabled after the surface is refreshed
- **AND** a session started in that folder from a terminal also treats the skill as disabled

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

## ADDED Requirements

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

Disabling a globally-defined resource at folder scope re-declares its directory in project settings, which causes pi to report that resource at project scope rather than user scope. The surface SHALL NOT let the row silently relocate to a different scope section as a result of the user's own toggle.

#### Scenario: A disabled global resource stays in view
- **GIVEN** a global skill listed in the global section of the folder Resources surface
- **WHEN** the user disables it
- **THEN** the row remains in the section where the user acted
- **AND** it indicates that this folder now controls the resource's activation

#### Scenario: Re-enabling restores the original grouping
- **GIVEN** a global resource previously disabled at folder scope
- **WHEN** the user re-enables it
- **THEN** the row is grouped exactly as it was before the disable

### Requirement: The surface SHALL state that a folder-scope disable is repository-wide

Because `.pi/settings.json` is tracked in version control, a folder-scope disable is a committed decision inherited by collaborators and by every worktree of the branch. The surface SHALL make this scope explicit rather than implying a machine-local preference.

#### Scenario: Folder scope communicates the shared blast radius
- **GIVEN** the folder Resources surface
- **WHEN** the user disables a resource
- **THEN** the surface indicates the change is written to the repository's `.pi/settings.json` and shared with anyone using the folder
