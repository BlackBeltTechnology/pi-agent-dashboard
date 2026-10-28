## MODIFIED Requirements

### Requirement: Resting on the collapsed bar peeks the dock as an overlay

On devices matching `(hover: hover) and (pointer: fine)`, resting on the collapsed summary bar SHALL peek the dock. The dwell and speed values are the session actions menu hover strip's: at least 300 ms on the bar, with speed below 0.4 px/ms over the most recent 100 ms. Unlike the strip, the bar button itself arms: the bar is the hover zone the user asked for, and clicking it pins. Leaving the bar first cancels. A peek SHALL show the lane region exactly as when expanded (rows, or chips and sheet in compact mode, with the same open lane), as an overlay that grows upward over the transcript. It SHALL NOT reflow the transcript, move the composer card, move focus, or refetch lane data. The bar SHALL NOT arm without fine hover, while a pointer button is pressed, while a dialog is open, while a dock menu opened by click or keyboard is open, or on a dock that is not live for its session (a frozen transition underlay). A peek SHALL end when the dock binds to another session.

The overlay and the summary bar SHALL read as one joined surface: only the overlay's outer top corners are rounded, the dock's own top edge shows no border or rounded corner while peeking, the overlay's side edges align with the dock's, the seam is a single hairline, no overlay shadow falls on the bar, and the bar shows no hover fill while peeking. The overlay SHALL stack above the chat pane's floating scroll controls, while the composer card keeps covering the dock's lower edge.

#### Scenario: Dwell peeks the dock
- **WHEN** the dock is collapsed and the pointer rests on the summary bar for 300 ms below the speed cutoff
- **THEN** the lane region SHALL render as an overlay above the bar
- **AND** the composer card's position and the transcript's scroll position SHALL be unchanged
- **AND** keyboard focus SHALL remain where it was

#### Scenario: Fast pass toward the composer does not peek
- **WHEN** the pointer crosses the summary bar toward the composer input at 1.5 px/ms without stopping
- **THEN** the dock SHALL NOT peek

#### Scenario: Compact peek shows chips and sheet
- **WHEN** the composer column is 480 px wide, the Changes lane was last open, and the collapsed bar is peeked
- **THEN** the overlay SHALL show the summary chips with the Changes sheet open below them

#### Scenario: Tall content scrolls inside the overlay
- **WHEN** the peeked lanes are taller than the chat pane space above the composer card
- **THEN** the overlay SHALL be no taller than that space and SHALL scroll internally

#### Scenario: Touch never peeks
- **WHEN** the device has no fine hover and the user taps the summary bar
- **THEN** the dock SHALL expand without a peek stage

#### Scenario: Peek overlay joins the bar as one surface
- **WHEN** the collapsed dock is peeked
- **THEN** the dock root SHALL show no top border and no top rounding
- **AND** the overlay SHALL carry the top rounding and an upward-only shadow
- **AND** the bar SHALL show no hover fill

#### Scenario: Peek overlay covers the chat scroll button
- **WHEN** the collapsed dock is peeked while the chat shows its scroll-to-bottom button behind the overlay
- **THEN** the overlay SHALL paint above that button
- **AND** the composer card SHALL still paint above the dock's lower edge
