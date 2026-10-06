## ADDED Requirements

### Requirement: Welcome tutorial is shipped and copied on version change
The server package SHALL contain a built welcome tutorial with a `version.json`. On boot, when `~/.pi/dashboard/welcome/version.json` is absent or differs, the server SHALL replace `~/.pi/dashboard/welcome/` atomically with the shipped copy, including a valid `.pi/home.json` marker. User-refreshed screenshots SHALL be preserved unless the shot manifest version changed.

#### Scenario: First boot
- **GIVEN** `~/.pi/dashboard/welcome` does not exist
- **WHEN** the server boots
- **THEN** it SHALL create the directory from the shipped copy

#### Scenario: Upgrade overwrites content
- **GIVEN** the installed welcome version is older than the shipped one
- **WHEN** the server boots
- **THEN** the tutorial pages SHALL be replaced by the shipped version

#### Scenario: Same version is a no-op
- **WHEN** the installed and shipped versions match
- **THEN** the server SHALL NOT rewrite the directory

### Requirement: Tutorial chapters
The tutorial SHALL present one section per feature, grouped into chapters in this order: Welcome & Anatomy; Connect a provider; Model roles; Start your first project; Knowledge base & DOX; Chat & controlling agents; Extensions & plugins; Everyday features; Use it from anywhere; Troubleshooting. Sections that depend on a plugin SHALL declare it and SHALL render an "enable in Plugins" notice instead of their figure when the plugin is disabled.

#### Scenario: Anatomy labels parts
- **WHEN** the Anatomy section renders
- **THEN** it SHALL label the layout parts (header bar, filter bar, add actions, folder groups, directory card, session card, session header, context bar, transcript, editor rail, composer status strip, composer) with letters reused by later sections

#### Scenario: Plugin-gated section
- **GIVEN** the goals plugin is disabled
- **WHEN** the Goals section renders
- **THEN** it SHALL show an enable notice linking to Settings ▸ Plugins

### Requirement: Start-your-first-project chapter explains the initializer
The chapter SHALL cover creating a folder (Add Folder, New folder, select), the Initialize action, and every project-init question in order: profile, stack confirmation, DOX, OpenSpec init, preview/confirm, overwrite confirm, global discipline-skills install (stating it affects all projects on the machine), and dox-describe. Each question SHALL state what it writes.

#### Scenario: Global side effect disclosed
- **WHEN** the discipline-skills question is described
- **THEN** the text SHALL state it writes `~/.pi/agent/settings.json` and applies to all projects

### Requirement: Model roles chapter gives type and size guidance
The chapter SHALL define size classes L (frontier), M (mid), S (small/flash) with cost bands, and for each role (`planning`, `coding`, `review`, `research`, `fast`, `naming`, `compact`, `vision`) show a one-line purpose, recommended type, size class, thinking level and hard requirement. It SHALL offer Quality, Balanced and Budget presets resolved against the user's reachable models, SHALL require image input for `vision`, and SHALL prefer a different model family for `review` than for `coding`. Applying a preset SHALL only prefill the Model roles page; the user saves. The chapter SHALL explain that roles are free-form names and how to add a custom role, without presenting non-existent roles as built in.

#### Scenario: Vision requires image input
- **WHEN** a preset is resolved
- **THEN** the `vision` role SHALL only be assigned a model whose input includes `image`

#### Scenario: Review uses another vendor
- **GIVEN** the user has reachable models from two families
- **WHEN** the Balanced preset is resolved
- **THEN** `review` SHALL be assigned a model of a different family than `coding`

#### Scenario: Preset is not saved silently
- **WHEN** the user applies a preset
- **THEN** the Model roles page SHALL open prefilled and no role SHALL change until the user saves

### Requirement: Remote-access chapter
The chapter SHALL walk through choosing a path (LAN, private mesh, public), installing and enabling zrok, reserving a stable share, a safety step, pairing a phone by QR with compare-code approval, pairing without a camera, and managing paired devices. The safety step SHALL warn when `trustedHasLoopback` is true. The chapter SHALL be hidden unless the status snapshot reports `features.remoteAccessSafe: true`.

#### Scenario: Loopback trust warning
- **GIVEN** the status snapshot reports `trustedHasLoopback: true`
- **WHEN** the safety step renders
- **THEN** it SHALL warn that the loopback entry must be removed before exposing a public URL

### Requirement: Themed and localized rendering
Tutorial pages SHALL be available in `en`, `hu` and `zh-CN`, SHALL style exclusively through dashboard theme tokens received over the bridge, and SHALL select light or dark figures to match the dashboard mode.

#### Scenario: Dark mode figure
- **WHEN** the dashboard is in dark mode
- **THEN** screenshot figures SHALL show their dark variant and specimens SHALL render with dark tokens
