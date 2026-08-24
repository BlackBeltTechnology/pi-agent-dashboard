# electron-build-pipeline Specification

## ADDED Requirements

### Requirement: First-party runtime plugins are bundled into resources/plugins/

The bundled dashboard server SHALL include every non-fixture runtime plugin in `packages/*`
(each package whose `package.json` carries a `pi-dashboard-plugin` manifest with
`fixture !== true`, and that is not itself bundled as a workspace package) so a fresh Electron
install exposes every plugin surface with no user-side install step. The set is declared by the
`BUNDLED_PLUGINS` array in `packages/electron/scripts/bundle-server.mjs`, and each entry SHALL
be copied into `resources/plugins/<plugin-dir>/`. The array SHALL contain no stale entry (an
entry with no matching runtime plugin on disk).

#### Scenario: Every runtime plugin dir is listed in BUNDLED_PLUGINS

- **WHEN** a non-fixture runtime plugin exists in `packages/*` (has a `pi-dashboard-plugin`
  manifest, `fixture !== true`, not in `BUNDLED_WORKSPACE_PKGS`)
- **THEN** its directory name SHALL appear in `BUNDLED_PLUGINS` in `bundle-server.mjs`
- **AND** `bundle-server.mjs` SHALL copy it into `resources/plugins/<plugin-dir>/`

#### Scenario: grammar-settings-plugin ships in the installer

- **WHEN** the Electron app is packaged
- **THEN** `resources/plugins/grammar-settings-plugin/` SHALL be present
- **AND** a fresh install SHALL show the Settings ▸ Plugins ▸ "Grammar & Spelling" surface

#### Scenario: No stale BUNDLED_PLUGINS entry

- **WHEN** a plugin dir is removed from `packages/*`
- **THEN** its name SHALL NOT remain in `BUNDLED_PLUGINS` (the completeness invariant rejects
  entries with no matching runtime plugin on disk)
