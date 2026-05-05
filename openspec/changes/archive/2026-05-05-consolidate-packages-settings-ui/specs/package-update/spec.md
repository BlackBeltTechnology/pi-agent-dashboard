## MODIFIED Requirements

### Requirement: Server lists installed packages
The server SHALL expose `GET /api/packages/installed?scope=global&cwd=<path>` that returns the list of configured packages using `packageManager.listConfiguredPackages()`. Each row in the response SHALL include the following fields:

- `source: string` — the raw source string (npm spec, git URL, or local path), as today.
- `scope: "user" | "project"` — as today.
- `installedPath: string | undefined` — the on-disk path where pi resolved the package, if installed.
- `version: string | undefined` — the `version` field read from `<installedPath>/package.json`, or `undefined` if the file is missing or unreadable.
- `displayName: string` — the `displayName` from `RECOMMENDED_EXTENSIONS` if the row matches a recommended entry; otherwise the bare package name extracted from the source (e.g. `pi-flows` from `https://github.com/.../pi-flows.git`); otherwise the raw `source` string as a fallback.
- `description: string | undefined` — the `description` field from `<installedPath>/package.json`, or the recommended manifest's `fallbackDescription` for matched recommended rows.
- `isRecommended: boolean` — `true` when the row's `source` matches a `RECOMMENDED_EXTENSIONS` entry via `matchesRecommendedSource()`.
- `isBundled: boolean` — `true` when `isRecommended === true` AND the row's id appears in `BUNDLED_EXTENSION_IDS` AND the bundled subtree exists under `<resourcesPath>/bundled-extensions/<id>/` (Electron-only; always `false` outside Electron).

These fields are additive. Existing clients that only consume `source` and `scope` SHALL continue to work without modification.

#### Scenario: List global packages
- **WHEN** client sends `GET /api/packages/installed?scope=global`
- **THEN** server returns the list of globally installed packages with source, scope, installedPath, version, displayName, description, isRecommended, isBundled

#### Scenario: List local packages
- **WHEN** client sends `GET /api/packages/installed?scope=local&cwd=/path/to/project`
- **THEN** server returns packages from `<cwd>/.pi/settings.json` enriched with the same fields

#### Scenario: Missing package.json on disk
- **WHEN** an installed package's `installedPath` exists but does not contain a readable `package.json`
- **THEN** the row's `version` and `description` SHALL be `undefined`
- **AND** the row SHALL still be returned (no error, no omission)

#### Scenario: Package matches recommended manifest
- **WHEN** an installed package's `source` matches a `RECOMMENDED_EXTENSIONS` entry via `matchesRecommendedSource()`
- **THEN** the row's `isRecommended` SHALL be `true`
- **AND** `displayName` SHALL come from the recommended manifest

#### Scenario: Package is in bundled list and bundle is present
- **WHEN** the row is recommended AND its id is in `BUNDLED_EXTENSION_IDS` AND `<resourcesPath>/bundled-extensions/<id>/` exists
- **THEN** the row's `isBundled` SHALL be `true`

#### Scenario: Outside Electron context
- **WHEN** the server runs in CLI mode (no `process.resourcesPath`)
- **THEN** every row's `isBundled` SHALL be `false`
