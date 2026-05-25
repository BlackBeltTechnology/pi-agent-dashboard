# first-run-wizard — delta

## ADDED Requirements

### Requirement: Splash and wizard windows are mutually exclusive on screen
The Electron main process SHALL NOT display the splash window and the first-run wizard window simultaneously. When transitioning into the `wizard-welcome` state, the splash window SHALL be closed before the wizard window is opened. When the wizard closes (user clicks `[Launch dashboard]` or dismisses), the splash MAY re-open to surface subsequent status updates (`Launching dashboard server…`, `Opening dashboard…`).

Rationale: the splash window is configured `alwaysOnTop: true` (to remain visible during the splash-only phases of `checking-server-health` and `loading-page-error`). If left open while the wizard is showing, the splash visually occludes the wizard on Windows — the user cannot see or interact with the `[Launch dashboard]` CTA, and the entire startup machine stalls awaiting `openWizardWindow`'s `'closed'` event.

#### Scenario: Splash closes before wizard opens
- **WHEN** the Electron main process transitions from `checking-server-health` to `wizard-welcome` (first launch, no `~/.pi/dashboard/first-run-done` marker)
- **THEN** the splash window SHALL be closed (via `closeSplash()`) before `openWizardWindow()` is called

#### Scenario: Splash re-opens after wizard closes
- **WHEN** the user clicks `[Launch dashboard]` in the wizard AND the wizard window closes AND the main process needs to surface `Launching dashboard server…` status
- **THEN** the splash window SHALL be re-shown (via `showSplash()`) before the next `updateSplashStatus()` call
- **AND** the re-opened splash SHALL display the new status text

#### Scenario: Only one window visible on Windows during wizard-welcome
- **WHEN** the user observes the screen during the `wizard-welcome` state on Windows
- **THEN** exactly ONE window SHALL be visible — the wizard window with the `[Launch dashboard]` CTA
- **AND** the splash window SHALL NOT be present

### Requirement: Wizard window grabs focus on ready-to-show
The first-run wizard window SHALL be constructed with `show: false` and SHALL listen for the `'ready-to-show'` event to call `.show()` and `.focus()`. This is the canonical Electron no-flash pattern and SHALL also guarantee that the wizard claims focus on Windows even if a sibling window (e.g. a delayed-closing splash) would otherwise capture it.

#### Scenario: No unstyled flash
- **WHEN** the wizard window opens on a fresh launch
- **THEN** the user SHALL NOT see an unstyled blank window for any visible duration before the styled wizard content paints

#### Scenario: Wizard takes focus
- **WHEN** the wizard window's `'ready-to-show'` event fires
- **THEN** the wizard window SHALL receive keyboard focus (`focus()` called)
- **AND** SHALL appear at the top of the window z-order

#### Scenario: Cross-platform behaviour
- **WHEN** the wizard opens on macOS or Linux
- **THEN** the show + focus behaviour SHALL be identical to Windows
- **AND** SHALL NOT regress the existing wizard launch on those platforms
