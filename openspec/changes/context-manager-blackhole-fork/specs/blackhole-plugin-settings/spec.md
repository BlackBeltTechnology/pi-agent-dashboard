## MODIFIED Requirements

### Requirement: The plugin self-gates on extension presence

An unsatisfied `requires.piExtensions` does not deactivate a plugin or drop its claims, so the plugin SHALL gate its own visibility rather than relying on the host to withhold it. The extension SHALL count as installed when pi's installed-package registry contains `pi-blackhole` or `@blackbelt-technology/pi-dashboard-context-manager` (whose fork reads the same config file). The manifest SHALL still declare `requires.piExtensions: ["pi-blackhole"]` for the Packages-page install affordance.

#### Scenario: Extension present

- **WHEN** `pi-blackhole` is installed and the plugin is enabled
- **THEN** `/settings/plugins/blackhole` SHALL render the configuration form

#### Scenario: Context-manager fork present

- **WHEN** `pi-blackhole` is absent from pi's installed-package registry and `@blackbelt-technology/pi-dashboard-context-manager` is present
- **THEN** `/settings/plugins/blackhole` SHALL render the configuration form

#### Scenario: Extension absent

- **WHEN** neither `pi-blackhole` nor `@blackbelt-technology/pi-dashboard-context-manager` is present in pi's installed-package registry
- **THEN** `/settings/plugins/blackhole` SHALL render a not-installed state naming the install command `pi install npm:pi-blackhole`
- **AND** SHALL NOT render any configuration control
- **AND** the not-installed state SHALL be produced by the plugin's own component, not by the host declining to mount it

#### Scenario: Installed-ness comes from the package registry, not the filesystem

- **WHEN** the plugin determines whether the extension is installed
- **THEN** it SHALL consult pi's installed-package registry, the same source the host's requirement probes use
- **AND** SHALL NOT infer installation from the existence of blackhole's directory or config file, which the extension creates on first run and which therefore means "has run at least once"

#### Scenario: Installed but never run

- **WHEN** `pi-blackhole` is in the package registry but has never run, so no config file exists
- **THEN** the settings page SHALL render the configuration form populated with defaults
- **AND** SHALL NOT render the not-installed state

#### Scenario: Manifest declares the requirement for the install prompt

- **WHEN** the manifest is inspected
- **THEN** `requires.piExtensions` SHALL list `pi-blackhole`
- **AND** the plugin SHALL NOT depend on that declaration to hide any surface

#### Scenario: Plugin declares no dependency on the extension package

- **WHEN** the repo-lint test reads `packages/blackhole-plugin/package.json`
- **THEN** neither `dependencies` nor `peerDependencies` nor `devDependencies` SHALL contain `pi-blackhole`
