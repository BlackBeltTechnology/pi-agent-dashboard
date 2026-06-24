## ADDED Requirements

### Requirement: npm package name encodes runtime kind

Every first-party package under the `@blackbelt-technology` scope SHALL carry an npm name whose shape encodes its runtime kind, so the name alone disambiguates a dashboard plugin from a pi extension.

The rules:

1. A package that declares a `pi-dashboard-plugin` manifest (loaded by the dashboard shell into React slots) SHALL be named `@blackbelt-technology/pi-dashboard-<name>-plugin`.
2. A package with no manifest that is loaded by the pi agent runtime (registers tools/hooks, listed in pi `packages[]`) and that depends on the dashboard SHALL be named `@blackbelt-technology/pi-dashboard-<name>-extension`.
3. A package with no manifest that is loaded by the pi agent runtime and is dashboard-independent (peerDep on a pi-coding-agent runtime, no dashboard dependency) SHALL be named `@blackbelt-technology/pi-<name>-extension`.

Shared infrastructure packages (`-shared`, `-server`, `-web`, `-client-utils`, `dashboard-plugin-runtime`) are exempt; they are neither plugins nor extensions.

#### Scenario: Dashboard plugin name
- **WHEN** a package declares `pi-dashboard-plugin` in its `package.json`
- **THEN** its npm name SHALL end in `-plugin` and begin with `@blackbelt-technology/pi-dashboard-`

#### Scenario: Standalone pi extension name
- **WHEN** a package has no `pi-dashboard-plugin` manifest, peers on a pi-coding-agent runtime, and has no dashboard dependency
- **THEN** its npm name SHALL match `@blackbelt-technology/pi-<name>-extension` and SHALL NOT carry the `pi-dashboard-` prefix

#### Scenario: image-fit conforms
- **WHEN** the image-fit extension is published
- **THEN** its npm name SHALL be `@blackbelt-technology/pi-image-fit-extension`
- **AND** its runtime brand (`[pi-image-fit]` log prefix, `os.tmpdir()/pi-image-fit` cache dir, `PI_IMAGE_FIT_*` env vars, `displayName`) SHALL remain unchanged

### Requirement: Renamed package deprecates its prior npm name

When a published package is renamed to conform to the convention, the prior npm name SHALL be deprecated (via `npm deprecate`) with a message pointing to the new name. The prior version SHALL NOT be unpublished.

#### Scenario: Old name deprecated, not unpublished
- **WHEN** `@blackbelt-technology/pi-image-fit` is renamed to `@blackbelt-technology/pi-image-fit-extension`
- **THEN** `@blackbelt-technology/pi-image-fit` SHALL be marked deprecated pointing to the new name
- **AND** existing published versions of the old name SHALL remain installable
