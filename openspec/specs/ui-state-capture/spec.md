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
For each captured state, theme and width, `captureStates` SHALL return the `contrastFailures`, `sizeFailures` and `buttonsWithoutFocusIndicator` results for the state's `root`, and an `overflow` list. `overflow` SHALL hold the `overflowFailures` result for the state's optional `overflowRoot` — every visible descendant whose `getBoundingClientRect` box, intersected with every `overflow≠visible` ancestor strictly inside the root (a fully clipped element is skipped), extends more than 0.5 px past the root's border box, where an element itself matching the state's `overflowTopExempt` selector is exempt on the top edge only — and SHALL be empty when the state declares no `overflowRoot`. `contrastFailures` and `sizeFailures` SHALL ignore screen-reader-only (`.sr-only`) text, and the overflow probe SHALL skip `.sr-only` elements. Each overflow entry SHALL name the element, the edge and the excess in px. Capture specs SHALL assert every list, including `overflow`, is empty.

#### Scenario: Low-contrast text fails the spec
- **WHEN** a state renders text below its contrast floor in any captured theme
- **THEN** the spec fails and names the state, theme, mode, width and the failing text

#### Scenario: Content past the root's border fails the spec
- **WHEN** a state declares an `overflowRoot` and a descendant (not matching `overflowTopExempt`) extends more than 0.5 px past that root's border box
- **THEN** the `overflow` list is non-empty and the spec fails, naming the state, theme, mode, width and the offending element

#### Scenario: A state without an overflow root is unaffected
- **WHEN** a state declares no `overflowRoot`
- **THEN** its `overflow` list is empty and no overflow measurement runs

#### Scenario: Screen-reader-only text is not held to visual floors
- **WHEN** a state's root contains a `.sr-only` span whose computed colours would fail the contrast floor
- **THEN** neither the `contrast` nor the `size` list names it, and the `overflow` list does not name it

#### Scenario: A top-exempt element still fails on other edges
- **WHEN** an element matching `overflowTopExempt` extends 7 px above and 3 px to the right of the root's border box
- **THEN** the `overflow` list holds exactly one entry, naming that element and the right edge
