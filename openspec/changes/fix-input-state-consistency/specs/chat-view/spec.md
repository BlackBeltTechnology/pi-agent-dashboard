## MODIFIED Requirements

### Requirement: One morphing send/stop action button
The composer SHALL render a single action button whose glyph and behaviour derive from session state, replacing the previous four-button cluster.
- WHEN idle with a non-empty draft, or with an empty draft and at least one pending image, it SHALL render a send affordance (enabled).
- WHEN idle with an empty draft and no pending image, it SHALL render the send affordance disabled.
- WHEN the session is working (`streaming` or `retrying`), it SHALL render a stop affordance. A first activation SHALL request abort and a second activation SHALL escalate to force-stop, preserving the existing `idle → aborting → killing` escalation semantics.

While working, the `stop-after-turn` affordance SHALL render immediately before the stop affordance, and the two SHALL form one labelled group (`Stop options`), not separate controls elsewhere in the composer. When the composer is narrow, the `after turn` label MAY collapse to an icon, which SHALL keep its accessible name. Every icon-only state SHALL carry an `aria-label`. The action button SHALL render at the trailing end of the composer's toolbar row (see "Composer card has an input row and one toolbar row"), SHALL be at least 44×44 CSS px, and SHALL paint its send and stop states from theme tokens rather than fixed palette colours. The force-stop state SHALL differ from the stop state by glyph as well as colour.

#### Scenario: Send disabled while empty
- **WHEN** the draft is empty, no image is pending and the session is idle
- **THEN** the action button SHALL render a disabled send affordance

#### Scenario: Send enabled with text
- **WHEN** the draft is non-empty and the session is idle
- **THEN** the action button SHALL render an enabled send affordance
- **AND** activating it SHALL send the draft

#### Scenario: Send enabled with an image only
- **WHEN** the draft is empty, one image is pending and the session is idle
- **THEN** the action button SHALL render an enabled send affordance
- **AND** activating it SHALL send the image with empty text

#### Scenario: Morph to stop while working
- **WHEN** the session status is `streaming`
- **THEN** the action button SHALL render a stop affordance
- **AND** a first activation SHALL request abort
- **AND** a second activation SHALL escalate to force-stop

#### Scenario: Stop-after-turn joins the stop control
- **WHEN** the session status is `streaming`
- **THEN** a stop-after-turn control SHALL render immediately before the stop affordance, in one group named `Stop options`
- **AND** activating it SHALL request stop-after-turn, not an abort

#### Scenario: Action button sits at the toolbar's trailing end
- **WHEN** the composer renders at any width
- **THEN** the action button SHALL be the last control of the toolbar row and SHALL NOT render in the input row

#### Scenario: Force-stop is not colour-only
- **WHEN** the stop state escalates to force-stop
- **THEN** the action button's glyph SHALL change as well as its colour
