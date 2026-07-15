# chat-view (delta)

## MODIFIED Requirements

### Requirement: Mobile composer adaptation

The composer toolbar SHALL fold based on the composer container width (container query), NOT the viewport width, so a narrow split chat pane on a wide viewport folds identically to a phone. When the composer container is narrow the toolbar SHALL keep a persistent row of `＋`, the model chip, a `⋯` overflow control, and the action button; thinking level, the `Steer | Queue` control, and the inline terminal SHALL be reachable from the `⋯` overflow, and attach/tools from the `＋` menu. The fold threshold SHALL sit above the toolbar's natural inline width so the fully-inline layout never overflows its pane. The send/stop action button SHALL be at least 44×44 CSS px and SHALL never be clipped by the pane.

#### Scenario: Overflow hosts folded controls on mobile
- **WHEN** the composer renders at phone width
- **THEN** the persistent toolbar row SHALL contain `＋`, model, `⋯`, and the action button
- **AND** thinking / delivery / terminal SHALL be reachable from `⋯`

#### Scenario: Narrow split pane folds controls on a wide viewport
- **WHEN** the composer renders inside a split chat pane narrower than the toolbar's
  natural inline width, while the browser viewport is wide
- **THEN** thinking / delivery / terminal SHALL fold into the `⋯` overflow
- **AND** the `Steer | Queue` control and the send/stop action button SHALL remain fully
  visible within the pane (no clipping by `overflow-hidden`)

#### Scenario: Wide composer keeps controls inline
- **WHEN** the composer container is at least as wide as the toolbar's natural inline width
- **THEN** thinking level, `Steer | Queue`, and the inline terminal SHALL render inline
- **AND** the `⋯` overflow control SHALL be hidden

#### Scenario: Action button meets touch-target minimum
- **WHEN** the composer renders at phone width
- **THEN** the send/stop action button SHALL be at least 44×44 CSS px
