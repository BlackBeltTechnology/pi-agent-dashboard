## MODIFIED Requirements

### Requirement: Repaired diagrams are visibly marked
A diagram rendered from repaired source SHALL display an auto-fixed indication: an info-severity "Auto-fixed" pill followed by each applied rule's localized description as visible text. Each rule SHALL render as its own element carrying `data-testid="mermaid-repair-rule"` and its rule code in a `data-rule` attribute (for example `data-rule="R5"`); the rule code SHALL NOT be the visible content. The indication SHALL also offer a control to show the original source (as received, before normalization) together with the original render error, and a named control to copy the repaired source. The repaired source is the source exactly as rendered: the normalized input with the listed rules applied. The controls SHALL be keyboard-operable, expose their state to assistive technology ("show original" via `aria-pressed`), and have accessible names from translated strings. The indication SHALL paint through theme tokens only (no Tailwind palette class, hex or `rgba(` literal) and pass the contrast, size and focus probes in `{base,dark}`, `{base,light}` and `{nord,dark}`. While the original is shown, the diagram and its zoom controls SHALL be neither visible nor keyboard-reachable. Toggling back SHALL restore the diagram with its previous zoom and pan, or its fitted scale if it was never zoomed. When the rendered outcome changes (new source or theme), the original view SHALL be closed.

#### Scenario: Badge names applied rules
- **WHEN** a diagram renders after rules R4 and R5 were applied
- **THEN** an "Auto-fixed" pill is shown with the diagram, followed by the descriptions of R4 and R5 as visible text
- **AND** the `mermaid-repair-rule` elements carry `data-rule` values `R4` and `R5`, and their visible text is the description, not the code

#### Scenario: Show original
- **WHEN** the user activates "show original" on a repaired diagram
- **THEN** the original source and the original render error are displayed instead of the diagram, and the diagram's controls cannot be reached by keyboard

#### Scenario: Toggle back keeps zoom
- **WHEN** the user zoomed a repaired diagram, showed the original, then toggled back
- **THEN** the diagram has the same zoom and pan as before

#### Scenario: Toggle back keeps fitted scale
- **WHEN** the user never zoomed a repaired diagram, showed the original, then toggled back
- **THEN** the diagram is shown at its fitted scale

#### Scenario: Show original after remount
- **WHEN** a repaired diagram is remounted from cache and the user activates "show original"
- **THEN** the original source and the original render error are displayed

#### Scenario: Outcome change closes the original view
- **WHEN** the original view is open and the diagram's source or theme changes
- **THEN** the original view closes and the new outcome is displayed

#### Scenario: Copy fixed source
- **WHEN** the user activates "copy fixed" on a repaired diagram
- **THEN** the repaired source is placed on the clipboard

### Requirement: Unrepairable diagrams keep the error display
When no rule applies, or the repaired source also fails to render, the renderer SHALL display the original source with the error message from the original render attempt, inside the error-severity callout defined by `mermaid-diagram` "Mermaid diagram rendering".

#### Scenario: No rule applies
- **WHEN** a diagram uses an unknown diagram type
- **THEN** the raw original code and the original error are displayed and no auto-fixed indication is shown

#### Scenario: Repair still fails
- **WHEN** rules apply but the repaired source still fails to render
- **THEN** the raw original code and the original error are displayed
