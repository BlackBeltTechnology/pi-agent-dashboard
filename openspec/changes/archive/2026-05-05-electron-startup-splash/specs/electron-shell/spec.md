## ADDED Requirements

### Requirement: Splash window appears immediately on app launch

The Electron main process SHALL create a splash window as the first action inside `app.whenReady()`, before any dependency detection, module resolution, or server launch work. The splash window SHALL be frameless, transparent, centered, alwaysOnTop, and non-resizable. It SHALL display a visual identity (pi logo + app name), a CSS spinner animation, and a status text line.

#### Scenario: Cold launch on Windows shows splash within 1 second

- **GIVEN** a Windows user double-clicks the packaged pi-dashboard executable on a cold-cached disk
- **WHEN** `app.whenReady()` resolves
- **THEN** a splash window SHALL appear within 1 second
- **AND** the splash SHALL be visible continuously until the next intended window (wizard or main) is ready to show
- **AND** no user action SHALL be required to dismiss it

#### Scenario: Failed splash render does not block startup

- **GIVEN** the splash window fails to create or render (e.g. GPU crash)
- **WHEN** the error is caught in `app.whenReady()`
- **THEN** the error SHALL be logged
- **AND** the main process SHALL continue to open the wizard or main window as normal

### Requirement: Status messages progress through detection phases

The splash window SHALL receive status updates via `webContents.send("splash:status", text)` from the main process. The main process SHALL emit a status update before each detection phase and before each window-transition phase.

#### Scenario: Each detection phase emits a status update

- **GIVEN** the main process runs dependency detection
- **WHEN** it invokes `detectSystemNode()`, `detectPi()`, `detectOpenSpec()`, `isDashboardRunning()`, or `launchServer()`
- **THEN** a corresponding status update SHALL be sent to the splash window before that call
- **AND** the status text SHALL be user-readable (e.g. "Checking Node.js…", not "detectSystemNode()")

### Requirement: Splash closes when the next window is ready

When the main process creates a wizard or main window, it SHALL close the splash only after the target window's `ready-to-show` event fires. This prevents a visible gap between splash and next window.

#### Scenario: Splash closes after main window is ready

- **GIVEN** splash is visible and main window is being created
- **WHEN** the main window emits `ready-to-show`
- **THEN** the splash window SHALL close
- **AND** the main window SHALL be shown in the same animation frame (no black flash)

#### Scenario: Splash closes after wizard window is ready

- **GIVEN** splash is visible and dependencies are missing, so the wizard is being created
- **WHEN** the wizard window emits `ready-to-show`
- **THEN** the splash window SHALL close
- **AND** the wizard window SHALL be shown
