## RENAMED Requirements

- FROM: `### Requirement: Streaming/resuming cards show horizontally drifting diagonal stripes layered with a breathing pulse`
- TO: `### Requirement: Streaming/resuming cards show a horizontal sweep gradient layered with a breathing tint`

- FROM: `### Requirement: Unread sessions display the cyan-stripes pulse`
- TO: `### Requirement: Unread sessions display the cyan sweep gradient`

## MODIFIED Requirements

### Requirement: Streaming/resuming cards show a horizontal sweep gradient layered with a breathing tint

Session cards in `streaming` or `resuming` state (carrying the `card-working-pulse` state class, painted via the `card-stripes-running` overlay) SHALL display an animated **horizontal sweep gradient** instead of diagonal barber-pole stripes:

1. A **soft, double-wide color band** in low-alpha amber that glides **purely horizontally** (left→right) across the card, over a faint flat amber tint underlay.
2. The band SHALL read as a calm sweep (the same feel as the pending sent-prompt shimmer), NOT as hard high-contrast edges crossing the text.

The loop SHALL be **seamless and fluid**: the overlay carries a *repeating* horizontal gradient (one soft band per period `P`) and is translated by exactly one period via `transform: translateX(0 → P)` at constant (`linear`) velocity. Because the gradient is periodic, position `0` and position `P` are identical, so the loop has no visible exit/re-entry or velocity snap. The animation SHALL be compositor-only (`transform`, no `background-position` repaint).

The state class name SHALL remain `card-working-pulse` (applied on `status === "streaming"` or `resuming === true`) and the overlay class `card-stripes-running`, so existing component logic and tests continue to apply them unchanged.

**Precedence**: unchanged — `card-working-pulse` takes priority over `card-unread-pulse`.

#### Scenario: Streaming session card sweeps amber

- **WHEN** a `streaming` session card renders
- **THEN** the rendered card element has the `card-working-pulse` class
- **AND** the overlay computes a horizontal (90°) amber gradient band over a flat amber tint
- **AND** an animation translates the overlay along the X axis by exactly one gradient period at constant velocity (seamless loop)

#### Scenario: Resuming session card uses the same sweep

- **WHEN** a `resuming` session card renders
- **THEN** the card has the `card-working-pulse` class with the same horizontal sweep gradient

### Requirement: Reduced-motion users get a static visual indicator

When the user's environment reports `prefers-reduced-motion: reduce`, the streaming/resuming card SHALL retain a clearly visible static amber-tinted background but SHALL NOT animate the sweep translation or any opacity pulsing.

#### Scenario: Reduced motion disables sweep but preserves the cue

- **GIVEN** the user has `prefers-reduced-motion: reduce` set
- **AND** a session card has the `card-working-pulse` class
- **THEN** no animations run on the element
- **AND** a static amber-tinted background still renders so the streaming state remains visually distinct from idle

### Requirement: Unread sessions display the cyan sweep gradient

A session card whose backing `DashboardSession.unread === true` SHALL display the `card-unread-pulse` state class (overlay `card-stripes-unread`) **unless** a higher-priority class applies (`card-input-stripes` for `ask_user`, `card-working-pulse` for streaming/resuming).

`card-stripes-unread` SHALL render the **same horizontal sweep gradient geometry, period, and timing** as `card-stripes-running`, but with cool cyan colors:

- the swept band color SHALL be a low-alpha cyan (approximately `rgba(34, 211, 238, 0.20)`, Tailwind `cyan-400`)
- the flat tint underlay SHALL be a low-alpha cyan (approximately `rgba(34, 211, 238, 0.05)`)
- the same `translateX`-one-period seamless keyframe SHALL be reused.

Cyan keeps its distinct corner of the palette (distant from amber streaming, purple ask_user, green alive-dot, red error) and reads as "calm attention".

#### Scenario: Unread alive session sweeps cyan

- **GIVEN** a session with `status: "idle"`, `currentTool: undefined`, `unread: true`
- **WHEN** the card renders
- **THEN** the card element SHALL have the `card-unread-pulse` class
- **AND** SHALL NOT have `card-working-pulse` or `card-input-stripes`
- **AND** the overlay computes a horizontal cyan sweep gradient

#### Scenario: Streaming-and-unread session prefers amber over cyan

- **GIVEN** a session with `status: "streaming"`, `unread: true`
- **WHEN** the card renders
- **THEN** the card element SHALL have the `card-working-pulse` class
- **AND** SHALL NOT have the `card-unread-pulse` class

### Requirement: Reduced-motion users get a static unread indicator

When the user's environment reports `prefers-reduced-motion: reduce`, the `card-unread-pulse` overlay SHALL retain a clearly visible static cyan-tinted background but SHALL NOT animate the sweep translation. This mirrors the rule for `card-working-pulse`.

#### Scenario: Reduced motion disables sweep but preserves the cue

- **GIVEN** the user has `prefers-reduced-motion: reduce` set
- **AND** a session card has the `card-unread-pulse` class
- **THEN** no animations SHALL run on the element
- **AND** a static cyan-tinted background SHALL still render
