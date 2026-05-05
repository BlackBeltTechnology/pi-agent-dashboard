## REMOVED Requirements

> Delta against the existing `first-run-wizard` capability in `openspec/specs/first-run-wizard/spec.md`. The wizard concept retires entirely; the underlying decisions (which install path, what to install, who owns lifecycle) are derived per launch from `selectLaunchSource()` + `DASHBOARD_STARTER` + `installable.json` reconcile.

### Requirement: Persistent mode flag

The Electron app SHALL no longer persist a startup-mode flag. The file `~/.pi-dashboard/mode.json` SHALL be deleted from the codebase. Existing files on disk SHALL be archived to `~/.pi/dashboard/migrate/<timestamp>/` on first launch of the new version (selective wipe — see `electron-bundle-extract` capability for the survive-extract whitelist).

#### Scenario: Removed — fresh machine no longer reads mode.json
- **WHEN** the app launches on a machine where `~/.pi-dashboard/mode.json` does not exist
- **THEN** no mode-file probe SHALL run; `selectLaunchSource()` resolves the launch source from filesystem capabilities only

#### Scenario: Removed — previous setup no longer reads mode.json
- **WHEN** the app launches on a machine where `~/.pi-dashboard/mode.json` exists from an older version
- **THEN** the file SHALL be archived to `~/.pi/dashboard/migrate/<ISO-timestamp>/` and ignored by the new code path

**Reason for removal:** The flag re-encoded facts already discoverable from filesystem capability probes (`which pi`, `which pi-dashboard`, `pi --version`, `~/.pi/agent/settings.json` parse). Recent Windows bring-up commits demonstrated the flag-driven path required idempotent reconciliation bolted on top, producing two sources of truth that disagreed under drift. Replaced by `selectLaunchSource()` per-launch resolver and `DASHBOARD_STARTER` runtime identity.

### Requirement: isFirstRun gate

The `isFirstRun()` helper SHALL no longer exist. The "first launch?" question is no longer asked; every launch runs the same idempotent reconciliation (capability probe → launch source resolution → server spawn → bootstrap install reconcile).

#### Scenario: Removed — first-launch detection no longer gates wizard
- **WHEN** the Electron app launches on any machine
- **THEN** no `isFirstRun()` branch SHALL execute; the same `selectLaunchSource() → spawnFromSource()` path runs every time

#### Scenario: Removed — installation-mode selection step
- **WHEN** a user launches the app for the first time
- **THEN** no "Standalone vs Power user" choice SHALL be presented; the launch source is derived from environment, and the unified setup screen renders only progress (extraction + bootstrap) when work is needed

**Reason for removal:** First-launch UX (recommended-extensions opt-in, API-key prompt) already had its own gates (`readRecommendedWizardState`, `isApiKeyConfigured`) independent of `mode.json`. Removing the umbrella gate clarifies that those concerns are independent.

### Requirement: decideStartupAction wrapper

The `decideStartupAction()` pure helper and its associated `power-user-install.ts` orchestration SHALL no longer exist. Replaced by `selectLaunchSource()` returning a discriminated `LaunchSource` union; the install side is no longer a separate concern but is performed by server bootstrap.

#### Scenario: Removed — Standalone mode installation step
- **WHEN** the launch source resolves to `extracted` (the closest equivalent of the old Standalone mode)
- **THEN** the bundled npm cache SHALL be extracted to `~/.pi-dashboard/` and missing packages reconciled by the server's `bootstrap-install-from-list` step (driven by `~/.pi/dashboard/installable.json`), not by Electron-side wizard code

#### Scenario: Removed — Power-user mode verification step
- **WHEN** the launch source resolves to `piExtension` or `npmGlobal`
- **THEN** no separate "verify pi and openspec on PATH" step SHALL run; the resolver's per-source probes already establish viability before spawn

**Reason for removal:** The wrapper existed to coordinate "auto-skip wizard but still install" — a pattern needed only because mode-flag presence and managed-dir population could disagree. With derived state and server-side install, the wrapper has nothing to orchestrate.
