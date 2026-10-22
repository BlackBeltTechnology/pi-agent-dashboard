## MODIFIED Requirements

### Requirement: Markdown preview replaces chat view

The canvas SHALL render **side-by-side** with the chat only on **desktop** viewports
(≥ 1024px wide AND ≥ 600px tall, per the repo's existing tier). On **tablet** (768–1023px wide,
≥ 600px tall) and **mobile** (< 768px wide OR < 600px tall) the canvas SHALL replace the ChatView,
the composer dock, and CommandInput (only SessionHeader and TokenStatsBar remain above it). Auto-open and
restore-on-reselect SHALL be viewport-gated **only on the mobile predicate** (< 768px wide OR
< 600px tall): there they surface a chip/badge the user taps rather than replacing chat. Tablet
auto-open replaces chat directly (it has room to return via the back affordance).

#### Scenario: Mobile preview active
- **GIVEN** a narrow viewport
- **WHEN** the user opens a preview
- **THEN** the ChatView, the composer dock, and CommandInput SHALL be hidden and the preview shown in their place

#### Scenario: Desktop side-by-side (boundary 1024px)
- **GIVEN** a viewport 1024px wide and 700px tall
- **WHEN** a canvas opens
- **THEN** the canvas renders beside the chat, which remains visible and usable

#### Scenario: Tablet replaces chat (boundary 1023px)
- **GIVEN** a viewport 1023px wide and 700px tall
- **WHEN** a canvas opens
- **THEN** the canvas replaces the chat (no side-by-side, no chip gate)

#### Scenario: Mobile auto-open does not yank chat (boundary 767px)
- **GIVEN** a viewport 767px wide and an agent turn that writes a qualifying deliverable
- **WHEN** the eager-open transition fires
- **THEN** a chip/badge is surfaced instead of replacing the chat
- **AND** the chat remains active until the user taps the chip

#### Scenario: Preview dismissed
- **WHEN** the user dismisses the preview
- **THEN** the preview SHALL be hidden and the chat surfaces restored
