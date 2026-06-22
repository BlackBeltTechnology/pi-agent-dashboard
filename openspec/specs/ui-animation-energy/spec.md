# ui-animation-energy Specification

## Purpose
Idle/hidden-state energy discipline for the web client. CSS animations MUST pause while the document is hidden, so a tray-hidden or backgrounded window does not drive continuous compositing. Decorative infinite animations (selected-card neon ring, card status stripes) MUST avoid per-frame rasterization and blur in steady state, animating only via compositor-only properties (`transform`) over static, once-rasterized gradients. The terminal cursor MUST NOT blink.
## Requirements
### Requirement: Pause animations when the document is hidden

The web client MUST pause all CSS animations while the document is not visible, so a window hidden to the tray or otherwise backgrounded does not drive continuous compositing. The client SHALL listen for `visibilitychange` (and window `blur`/`focus`) and toggle an `app-hidden` class on the document root element. While `app-hidden` is set, all elements and pseudo-elements MUST have `animation-play-state: paused`. Animations MUST resume automatically when the document becomes visible again. This behavior MUST NOT depend on Electron occlusion flags or `backgroundThrottling`.

#### Scenario: window hidden to tray pauses animations

- **GIVEN** the dashboard window is visible with a selected session card (neon ring animating)
- **WHEN** the window is hidden to the tray and `document.visibilityState` becomes `hidden`
- **THEN** the document root SHALL carry the `app-hidden` class
- **AND** the selected card's ring animation SHALL be paused (`animation-play-state: paused`)
- **AND** the renderer and GPU processes SHALL drop to near-idle CPU within seconds

#### Scenario: restoring the window resumes animations

- **GIVEN** the window is hidden to the tray with animations paused
- **WHEN** the window is shown again and `document.visibilityState` becomes `visible`
- **THEN** the `app-hidden` class SHALL be removed
- **AND** the selected card's ring animation SHALL resume

### Requirement: Decorative infinite animations avoid per-frame rasterization

Decorative always-on animations (the selected-card neon ring) MUST NOT re-rasterize on every frame in steady state. The selected-card ring MUST animate via compositor-only properties (e.g. `transform`) over a static gradient, rather than animating a registered custom property that drives a `conic-gradient` angle. Any blur applied to the ring MUST be applied to a static layer so it rasterizes once and caches, not per frame. The existing `prefers-reduced-motion` and conic-gradient `@supports` fallbacks MUST be preserved.

#### Scenario: selected card ring is compositor-only while visible

- **GIVEN** a visible session card with the selected ring applied
- **WHEN** the ring animation runs
- **THEN** the ring SHALL animate via a `transform` on a static gradient layer
- **AND** the gradient SHALL NOT be re-rasterized per frame
- **AND** the renderer and GPU CPU usage SHALL remain low at idle compared to the angle-animated implementation

#### Scenario: reduced-motion still disables the ring

- **GIVEN** macOS Reduce Motion (or `prefers-reduced-motion: reduce`) is enabled
- **WHEN** a session card is selected
- **THEN** the ring animation SHALL be disabled (`animation: none`)

### Requirement: Card status stripes are compositor-only

The scrolling status stripes on running, unread, and ask_user (waiting-for-question) session cards (`card-working-pulse`, `card-unread-pulse`, `card-input-stripes`) MUST animate via a compositor-only property (`transform`) over a static repeating gradient, rather than animating `background-position` (which forces a per-frame repaint of every active card). The ask_user state MUST use the same scrolling-stripe mechanism in the question color (purple), replacing the prior `background-color` tint pulse (`card-input-pulse`); the three states MUST share one set of transform keyframes and differ only by gradient color (running=yellow, unread=cyan, ask_user=purple). The accompanying opacity pulse MAY remain (opacity is compositor-only). The translation MUST loop seamlessly over one tile period and MUST be clipped to the card so the tile does not bleed past the border. The `prefers-reduced-motion` guard MUST be preserved.

#### Scenario: running-card stripes scroll without per-frame repaint

- **GIVEN** a session card with active (running) status and its scrolling stripes
- **WHEN** the stripe animation runs
- **THEN** the stripes SHALL scroll via a `transform` on a static gradient overlay
- **AND** `background-position` SHALL NOT be animated
- **AND** the scrolling SHALL look equivalent to the prior implementation with no tile bleed past the card border

#### Scenario: ask_user card uses purple stripes

- **GIVEN** a session whose current tool is `ask_user` (and no widget-bar slot owns the prompt)
- **WHEN** the card status indicator renders
- **THEN** the card SHALL show scrolling stripes in the question color (purple) via the shared `transform`-based mechanism
- **AND** it SHALL NOT use a `background-color` tint pulse

#### Scenario: stripes pause when hidden and under reduced motion

- **GIVEN** running or unread cards with scrolling stripes
- **WHEN** the document becomes hidden OR `prefers-reduced-motion: reduce` is active
- **THEN** the stripe animation SHALL be paused or disabled

### Requirement: Terminal cursor does not blink

The terminal view MUST NOT enable cursor blinking, to avoid a recurring per-second repaint while a terminal tab is open and idle.

#### Scenario: terminal cursor is static

- **GIVEN** a terminal tab is open and idle
- **WHEN** the cursor is rendered
- **THEN** the cursor SHALL NOT blink (`cursorBlink: false`)

