## MODIFIED Requirements

### Requirement: Zoom control buttons
The MermaidBlock component SHALL display overlay control buttons for zoom in (+), zoom out (−), and reset (fit to container). The buttons SHALL be shown only while the diagram is activated (by click or by keyboard, see "Click-to-activate focus model") and SHALL then be reachable with Tab.

#### Scenario: Zoom in button
- **WHEN** the user clicks the zoom-in (+) button
- **THEN** the diagram SHALL zoom in by a fixed step (e.g., 1.2× multiplier)

#### Scenario: Zoom out button
- **WHEN** the user clicks the zoom-out (−) button
- **THEN** the diagram SHALL zoom out by a fixed step

#### Scenario: Reset button
- **WHEN** the user clicks the reset button
- **THEN** the diagram SHALL return to its initial scale and position (fit to container)

#### Scenario: Double-click to reset
- **WHEN** the user double-clicks on the diagram
- **THEN** the diagram SHALL reset to its initial scale and position

#### Scenario: Control button visibility when focused
- **WHEN** a Mermaid diagram is activated by a click or by pressing Enter on its focused viewport
- **THEN** zoom control buttons SHALL be displayed overlaid on the diagram container and SHALL be reachable with Tab

#### Scenario: Control buttons hidden when unfocused
- **WHEN** a Mermaid diagram is not activated
- **THEN** zoom control buttons SHALL NOT be displayed

### Requirement: Click-to-activate focus model
Zoom and pan interactions SHALL only be active when the user has activated the diagram (the "focused state" in other requirements of this capability), either by clicking it or by pressing Enter while its viewport has keyboard focus. The viewport SHALL be in the Tab order (`tabindex="0"`), carry `role="group"` and the translated accessible name "Diagram. Press Enter to zoom and pan, Escape to leave.", and show the `--focus-ring` indicator when focused or activated; no Tailwind palette class SHALL paint it. When not activated, scroll and touch events SHALL pass through to the page normally, and a keyboard focus that merely passes through the viewport SHALL NOT activate it.

#### Scenario: Click to focus
- **WHEN** the user clicks on an unfocused Mermaid diagram
- **THEN** the diagram SHALL enter the activated state with the `--focus-ring` indicator and enable zoom/pan interactions

#### Scenario: Click outside to deactivate
- **WHEN** the user clicks outside a focused Mermaid diagram
- **THEN** the diagram SHALL exit focused state and zoom/pan interactions SHALL be disabled

#### Scenario: Escape to deactivate
- **WHEN** the user presses Escape while a Mermaid diagram is focused
- **THEN** the diagram SHALL exit focused state
- **AND** keyboard focus SHALL return to the viewport

#### Scenario: Hover hint when unfocused
- **WHEN** the user hovers over or keyboard-focuses an unactivated Mermaid diagram
- **THEN** the hint "Enter or click to zoom" SHALL appear as a small pill without a scrim

#### Scenario: Scroll passthrough when unfocused
- **WHEN** the user scrolls over an unfocused Mermaid diagram
- **THEN** the page SHALL scroll normally without zooming the diagram

#### Scenario: Enter activates from the keyboard
- **WHEN** the diagram viewport has keyboard focus and the user presses Enter
- **THEN** the diagram SHALL enter the activated state and the zoom control buttons SHALL be reachable with Tab

#### Scenario: Tabbing through does not activate
- **WHEN** the user tabs onto the viewport and then tabs away without pressing Enter
- **THEN** the diagram SHALL NOT enter the activated state and page scrolling SHALL be unaffected
