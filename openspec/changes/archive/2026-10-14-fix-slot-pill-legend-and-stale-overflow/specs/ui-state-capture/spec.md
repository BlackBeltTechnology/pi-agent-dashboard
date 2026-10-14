## MODIFIED Requirements

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
