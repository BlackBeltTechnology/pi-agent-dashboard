# Delta: command-executor

## ADDED Requirements

### Requirement: whereStrategy filters AppImage self-hits
The `whereStrategy(name)` resolver in `@blackbelt-technology/pi-dashboard-shared/tool-registry/strategies` SHALL discard any candidate path that matches the running process's own Electron launcher when the host runs as a Linux AppImage. This mirrors the precedent set by the `_npx` filter in `detectPiDashboardCli()` — *filter known-bogus shapes from PATH lookup at the lowest reusable layer* — so every tool resolved through the registry inherits the guard transparently.

A candidate path SHALL be considered an AppImage self-hit when any of the following is true:
- its realpath equals the realpath of `process.execPath`, OR
- it lives under the directory named by `process.env.APPDIR` (the AppImage squashfs mount), OR
- its realpath equals the realpath of `process.env.APPIMAGE`.

When the candidate is rejected, `whereStrategy` SHALL return `{ ok: false, reason: "appimage-self-hit: <path>" }` so the rejection is visible in the registry's diagnostic trail.

#### Scenario: whereStrategy rejects AppImage-mount candidate
- **GIVEN** `process.env.APPDIR = "/tmp/.mount_PI-Das…"`
- **AND** `whichSync("pi-dashboard")` returns `/tmp/.mount_PI-Das…/pi-dashboard`
- **WHEN** `whereStrategy("pi-dashboard").run()` is called
- **THEN** the result SHALL be `{ ok: false, reason: "appimage-self-hit: /tmp/.mount_PI-Das…/pi-dashboard" }`

#### Scenario: whereStrategy rejects process.execPath self-hit
- **GIVEN** `process.execPath = "/opt/pi-dashboard/pi-dashboard"`
- **AND** `whichSync("pi-dashboard")` returns the same path (or a symlink whose realpath is the same)
- **WHEN** `whereStrategy("pi-dashboard").run()` is called
- **THEN** the result SHALL be `{ ok: false, reason: "appimage-self-hit: <path>" }`

#### Scenario: whereStrategy continues to PATH walk for non-AppImage hits
- **GIVEN** no AppImage env vars are set and `process.execPath` is unrelated to the candidate
- **AND** `whichSync("git")` returns `/usr/bin/git`
- **WHEN** `whereStrategy("git").run()` is called
- **THEN** the result SHALL be `{ ok: true, path: "/usr/bin/git" }`

#### Scenario: Registry diagnostic trail records the rejection
- **GIVEN** a tool definition whose strategy chain ends with `whereStrategy(toolName)`
- **AND** every earlier strategy returns `{ ok: false }` and `whereStrategy` rejects an AppImage self-hit
- **WHEN** `registry.resolve(toolName)` is called
- **THEN** the resulting `Resolution.tried` array SHALL include an entry for `where` with `reason` containing `"appimage-self-hit"`
- **AND** `Resolution.ok` SHALL be `false`
