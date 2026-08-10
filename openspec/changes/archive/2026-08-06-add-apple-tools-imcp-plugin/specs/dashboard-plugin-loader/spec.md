## ADDED Requirements

### Requirement: `PluginRequirements` SHALL support a filesystem-path category

`PluginRequirements` SHALL accept an optional `paths?: string[]` category alongside `piExtensions`, `binaries`, and `services`. It expresses dependencies that exist at a known absolute location but do not resolve on `PATH` — for example a CLI bundled inside a macOS `.app`, or a platform binary under a fixed install prefix. `PluginRequirementReport` SHALL gain a matching `paths: { name: string; satisfied: boolean }[]` field.

#### Scenario: Declared path that exists is satisfied

- **WHEN** a plugin declares `requires: { paths: ["/Applications/Example.app/Contents/MacOS/example"] }` and that file exists
- **THEN** the probe report's `paths` array contains that name with `satisfied: true`

#### Scenario: Declared path that is absent is unsatisfied

- **WHEN** a plugin declares a `paths` requirement for a file that does not exist
- **THEN** the probe report's `paths` array contains that name with `satisfied: false`
- **AND** the name appears in the plugin's flattened `missingRequirements`

#### Scenario: Path probe does not execute the target

- **WHEN** the runtime probes a `paths` requirement
- **THEN** it performs an existence check only
- **AND** it does not execute, spawn, or read the contents of the target file

#### Scenario: Declared path is treated as untrusted manifest input

- **WHEN** a plugin declares a `paths` requirement whose value contains shell metacharacters
- **THEN** the value is never interpolated into a shell command and no shell is invoked
- **AND** the probe treats it as an opaque filesystem path

#### Scenario: Legitimate paths containing spaces are not rejected

- **WHEN** a plugin declares a `paths` requirement for an existing file whose absolute path contains spaces
- **THEN** the probe reports it satisfied
- **AND** the value is not rejected by any character denylist

#### Scenario: Non-absolute path is unsatisfied

- **WHEN** a plugin declares a `paths` requirement that is not an absolute path
- **THEN** the probe reports it unsatisfied rather than resolving it relative to any working directory

### Requirement: `paths` entries SHALL support plugin-config interpolation

A `paths` entry MAY contain a single `${<configKey>}` placeholder resolved from the declaring plugin's own validated configuration before probing. This lets one declaration track an operator-configured location, so the requirement pill and the plugin's own status cannot disagree about the same host. Resolution is a configuration read and SHALL NOT invoke a shell.

#### Scenario: Placeholder resolves from plugin config

- **WHEN** a plugin declares `paths: ["${examplePath}"]` and its validated config sets `examplePath` to an existing absolute path
- **THEN** the probe reports the requirement satisfied

#### Scenario: Default config value behaves as a literal

- **WHEN** the declaring plugin's config leaves the referenced key at its schema default
- **THEN** the probe resolves the default and behaves exactly as an equivalent literal declaration would

#### Scenario: Unresolvable placeholder is unsatisfied, not an error

- **WHEN** a `paths` entry references a config key absent from the plugin's schema, or resolving to a non-absolute value
- **THEN** the probe reports the requirement unsatisfied
- **AND** the loader does not throw and the remaining requirement categories are still probed

### Requirement: The `paths` category SHALL be backward compatible

Existing manifests that declare no `paths` SHALL behave exactly as before the category was introduced. The category is additive and optional.

#### Scenario: Manifest without paths is unaffected

- **WHEN** a plugin declares `requires` with only `piExtensions` and `binaries`
- **THEN** its probe report's `paths` array is empty
- **AND** its `missingRequirements` contents and ordering are identical to the pre-existing behaviour

#### Scenario: Plugin with no requires at all is unaffected

- **WHEN** a plugin declares no `requires` field
- **THEN** the loader reports `missingRequirements` as an empty array as before

### Requirement: Missing `paths` requirements SHALL surface in the activation UI

Unsatisfied `paths` requirements SHALL flow through the same `PluginStatus.requirements` / `missingRequirements` channel as the other categories. The activation UI SHALL render the new category alongside the three existing ones; because the client derives its rendered lists per category rather than from the flattened `missingRequirements`, this requires a corresponding client change and is NOT satisfied by the server-side plumbing alone.

#### Scenario: Unsatisfied path renders a warning pill

- **WHEN** a plugin row has an unsatisfied `paths` requirement
- **THEN** the Plugins tab renders a warning pill naming that requirement
- **AND** the missing-requirements block is not rendered empty, which is what would occur if the client derived its rendered lists from only the three pre-existing categories

#### Scenario: Path requirements offer no one-click install

- **WHEN** a plugin row has an unsatisfied `paths` requirement
- **THEN** no inline `[Install]` button is rendered for it, because a filesystem path has no package source to install from
- **AND** the existing non-package fallback affordance is rendered instead

### Requirement: Path probe results SHALL respect the existing probe cache

`paths` probes SHALL participate in the same per-plugin time-to-live cache as the other requirement categories.

#### Scenario: Repeated probes within the window reuse the cache

- **WHEN** a plugin's requirements are probed twice inside the cache window
- **THEN** the second call returns the cached report without re-checking the filesystem
