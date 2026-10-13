# ui-state-capture Specification

## Purpose
TBD - created by archiving change retro-ux-identity-connectivity. Update Purpose after archive.

## Requirements

### Requirement: Named UI states are seeded by route fixtures
The E2E suite SHALL provide per-surface fixture modules under `tests/e2e/fixtures/retro-ux/` that each export an ordered list of states `{ id, label, stubs, install(page), open(page), root(page) }`, run by Playwright in the standard E2E docker harness (`docker/test-up.sh`). `stubs` SHALL name at least one REST endpoint, and `install` SHALL reach the state only by answering those endpoints with `page.route`. `open` SHALL bring the surface into view (navigate to its settings tab, or click the trigger to open a menu). `root` SHALL return the locator the probes measure: the trigger for a closed selector, and the `role="menu"` element located from the page (not the trigger's subtree) for an open, portalled menu.

#### Scenario: State is reached through its stubs
- **WHEN** a capture spec installs a fixture state and opens the surface
- **THEN** the surface renders that state, and every endpoint in the state's `stubs` list was answered by its stub at least once

#### Scenario: Stubs survive the theme reload
- **WHEN** the capture switches theme with `setThemeMode` (which reloads the page) after `install`, then sets the viewport and calls `open`
- **THEN** the reloaded page renders the same state from the same stubs

### Requirement: Capture writes per-theme, per-viewport evidence only on opt-in
`captureStates(page, { change, surface, states, only?, themes?, widths? })` SHALL capture every requested state in each requested theme and mode, by default `{base,dark}`, `{base,light}` and `{nord,dark}` (exported as one constant), at each requested width, by default 375, 768 and 1440. It SHALL write PNG files to `<change dir>/mockups/after/<surface>/<state>--<theme>-<mode>--<width>.png` only when `RETRO_UX_CAPTURE=1`. The change dir SHALL be the directory containing `resolveEvidencePath(change)`; capture SHALL refuse to write when that directory lies under `openspec/changes/archive/`, and SHALL create only the `mockups/after/<surface>/` folder inside an existing change dir, never the change dir itself.

#### Scenario: Opt-in run writes the full matrix
- **WHEN** `RETRO_UX_CAPTURE=1` and a surface has 2 states with the default themes and widths
- **THEN** exactly 18 PNG files exist under that surface's `mockups/after/` folder

#### Scenario: Default run writes no evidence
- **WHEN** the capture spec runs without `RETRO_UX_CAPTURE`
- **THEN** no screenshot or evidence file is created or modified (Playwright's own failure artifacts are outside this guarantee)

#### Scenario: Unknown state id is rejected
- **WHEN** `only` names a state id the passed `states` list does not contain
- **THEN** the helper throws an error naming the surface and the unknown id before any navigation

#### Scenario: Archived or missing change dir fails loudly
- **WHEN** `RETRO_UX_CAPTURE=1` and the change resolves to an archived change or to no change
- **THEN** the helper throws and writes nothing

### Requirement: Capture reports contract probes per state
For each captured state, theme and width, `captureStates` SHALL return the `contrastFailures`, `sizeFailures` and `buttonsWithoutFocusIndicator` results for the state's `root`. Capture specs SHALL assert each list is empty.

#### Scenario: Low-contrast text fails the spec
- **WHEN** a state renders text below its contrast floor in any captured theme
- **THEN** the spec fails and names the state, theme, mode, width and the failing text
