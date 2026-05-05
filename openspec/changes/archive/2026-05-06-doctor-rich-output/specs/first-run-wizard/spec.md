## ADDED Requirements

### Requirement: Doctor escape hatch from wizard
The first-run wizard SHALL surface a link or button labelled "Run Doctor" alongside the existing Skip affordance so users who hit a wizard error can pivot to the diagnostic surface without restarting the app.

#### Scenario: Doctor link visible on wizard
- **WHEN** the wizard is open on any step
- **THEN** a "Run Doctor" affordance SHALL be visible in the wizard footer area near the Skip / Cancel control

#### Scenario: Doctor link opens the Doctor window
- **WHEN** the user clicks the "Run Doctor" affordance
- **THEN** the Doctor BrowserWindow SHALL open (or focus if already open)
- **AND** the wizard window SHALL remain open in the background so the user can return to it
