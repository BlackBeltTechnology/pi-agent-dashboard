## ADDED Requirements

### Requirement: Bundled bridge extension lives under node_modules

The bundled runtime's bridge-extension directory SHALL be
`<resources>/server/node_modules/@blackbelt-technology/pi-dashboard-extension`, the same layout
overlays use. When the app starts on the bundled runtime and the pi settings still reference the
pre-change path `<resources>/server/packages/extension`, the app SHALL replace that reference with
the new path, leaving exactly one dashboard bridge extension registered.

#### Scenario: Fresh install registers the node_modules path
- **WHEN** the app starts on the bundled runtime with no dashboard bridge extension registered
- **THEN** the pi settings SHALL reference `<resources>/server/node_modules/@blackbelt-technology/pi-dashboard-extension`

#### Scenario: Upgrade replaces the stale packages path
- **WHEN** the app starts on the bundled runtime AND the pi settings reference `<resources>/server/packages/extension`
- **THEN** the pi settings SHALL reference the node_modules extension path and SHALL NOT reference the `packages/extension` path
