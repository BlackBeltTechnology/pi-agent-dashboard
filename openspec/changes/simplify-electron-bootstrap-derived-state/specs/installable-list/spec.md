## ADDED Requirements

### Requirement: installable.json schema and location

The dashboard SHALL maintain a single canonical package list at `~/.pi/dashboard/installable.json` shared across all starters. The file SHALL conform to the schema `{ version: string, packages: InstallablePackage[] }` where each `InstallablePackage` carries `name`, `version` (semver range or `"*"`), `required` (boolean), and `kind` (`"npm" | "pi-extension"`).

#### Scenario: Read produces empty default when missing

- **WHEN** `readInstallableList()` is invoked AND the file does not exist
- **THEN** the function SHALL return the bundled default list (the version baked into the running build)
- **AND** SHALL NOT create the file as a side effect

#### Scenario: Atomic write preserves existing pins on partial failure

- **WHEN** `writeInstallableList(list)` is invoked
- **THEN** the function SHALL write to a temp file then rename atomically
- **AND** SHALL NOT leave a partial or zero-byte file at the canonical path on any failure mode

#### Scenario: Schema rejection of unknown kind

- **WHEN** `readInstallableList()` parses a file with an entry whose `kind` is outside the enum
- **THEN** the function SHALL log a warning AND drop the entry from the returned list
- **AND** SHALL NOT throw

### Requirement: Merge-on-upgrade semantics

When the bundle version differs from the stored `installable.json` version, the dashboard SHALL merge the bundled defaults with the user's existing list using the rules: keep user's pinned versions when the package is still in defaults; warn but keep the pin when the package is dropped from defaults; add new bundled packages with their default `required` and `version`; mark new optional packages as opt-in (default-off in UI).

#### Scenario: User pin retained for still-present package

- **WHEN** `mergeInstallableList(existing, bundled)` runs AND `existing` has `tsx@^4.0.0` AND `bundled` has `tsx@^5.0.0`
- **THEN** the merged result SHALL retain `tsx@^4.0.0` (user pin wins)
- **AND** the merged result SHALL include a `warnings: string[]` entry noting the bundled default differs

#### Scenario: Dropped package kept with deprecated flag

- **WHEN** `mergeInstallableList(existing, bundled)` runs AND `existing` has a package not present in `bundled`
- **THEN** the merged result SHALL retain the package
- **AND** SHALL set its `deprecated: true` flag
- **AND** SHALL include a warning identifying the package

#### Scenario: New required package added

- **WHEN** `mergeInstallableList(existing, bundled)` runs AND `bundled` has a package with `required: true` not present in `existing`
- **THEN** the merged result SHALL include the new package with `required: true`

#### Scenario: New optional package added with default-off

- **WHEN** `mergeInstallableList(existing, bundled)` runs AND `bundled` has a package with `required: false` not present in `existing`
- **THEN** the merged result SHALL include the new package with `required: false`
- **AND** the package SHALL be marked as `defaultOff: true` in the merge result for UI consumption

### Requirement: Server-side bootstrap reconciliation

The dashboard server SHALL invoke `bootstrapInstallFromList()` before binding the HTTP listener. The reconcile loop SHALL classify each package (installed-and-version-matches vs needs-install), invoke the appropriate install path per `kind`, emit per-package progress events through `bootstrap-state`, and gate `bootstrap.status === "ready"` on completion of all required packages.

#### Scenario: Required package failure aborts bootstrap

- **WHEN** `bootstrapInstallFromList()` runs AND a `required: true` package install fails
- **THEN** the function SHALL emit an error event for the package
- **AND** SHALL set `bootstrap.status = "error"`
- **AND** the server SHALL NOT bind the HTTP listener
- **AND** the structured error SHALL identify the failed package and root cause

#### Scenario: Optional package failure logged but bootstrap continues

- **WHEN** `bootstrapInstallFromList()` runs AND a `required: false` package install fails
- **THEN** the function SHALL emit an error event for the package
- **AND** SHALL mark the package as `failed` in bootstrap-state
- **AND** SHALL continue with remaining packages
- **AND** the server SHALL bind the HTTP listener once required packages are complete

#### Scenario: All packages already installed — fast path

- **WHEN** `bootstrapInstallFromList()` runs AND every package in the list reports installed and version-satisfied
- **THEN** the function SHALL emit no install events
- **AND** SHALL set `bootstrap.status = "ready"` immediately
- **AND** the server SHALL bind without delay

#### Scenario: pi-extension kind uses pi package-manager-wrapper

- **WHEN** `bootstrapInstallFromList()` encounters an entry with `kind: "pi-extension"` that needs install
- **THEN** the function SHALL invoke the same install code path used by `POST /api/packages/install`
- **AND** SHALL NOT bypass pi's `DefaultPackageManager`

### Requirement: Server reports installable progress via WS

The server SHALL emit `bootstrap-state` events on the existing dashboard event channel reporting installable reconciliation progress. Each event SHALL identify the package being installed and its status (`running | done | error`).

#### Scenario: Per-package start event

- **WHEN** the reconcile loop begins installing a package
- **THEN** the server SHALL emit a `bootstrap_progress` event with `{ step: <package-name>, status: "running" }`

#### Scenario: Per-package completion event

- **WHEN** the reconcile loop completes a package install successfully
- **THEN** the server SHALL emit a `bootstrap_progress` event with `{ step: <package-name>, status: "done" }`

#### Scenario: Per-package error event

- **WHEN** the reconcile loop encounters an install failure
- **THEN** the server SHALL emit a `bootstrap_progress` event with `{ step: <package-name>, status: "error", error: <message> }`
