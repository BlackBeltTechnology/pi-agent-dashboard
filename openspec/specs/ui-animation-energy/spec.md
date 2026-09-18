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

### Requirement: Pause animations when the UI is visible but idle

The web client MUST pause all CSS animations while the document is visible but
the user has not interacted with it for an idle delay, so that an unattended
dashboard left open on screen produces no continuously-animating content and the
browser's compositor can reach idle.

The client SHALL treat deliberate user input — pointer press, wheel, key press,
touch start, and focus entering an element — as activity, observed such that
activity anywhere in the document counts. After the idle delay elapses with no
such activity, the client SHALL mark the document root idle; while marked, all
elements and pseudo-elements MUST have `animation-play-state: paused`. Any
activity SHALL clear the mark immediately and restart the delay, and animations
MUST resume without a page reload.

Pointer movement and scrolling SHALL NOT count as activity: a resting hand emits
pointer micro-movements and streaming auto-scroll emits scroll events, either of
which would hold animations running indefinitely during an unattended session.

The pause SHALL apply to all animations, including those on background session
cards (status stripes, status-dot pulses), not only the selected card's
decorative treatment — the per-frame cost is incurred by any running animation.
State that is communicated by animation MUST remain legible while paused via its
static styling, and the selected session MUST retain a static, non-animated
selection affordance. No functional behavior may depend on an animation running
or completing.

Indeterminate progress indicators are the one exception and SHALL keep animating
while idle. Unlike pausing for a hidden document, this pause applies while the
user is looking at the screen, where a frozen spinner misreports an in-progress
operation as a hung one. The exemption SHALL be expressed as declarative
rules keyed on shared indicator classes rather than per-component styling, and
SHALL cover indicators animated by an injected inline style as well as those
animated by a utility class, so that no in-flight indicator is exempt merely by
virtue of how its animation is applied. Decorative liveness animations that merely restate a
state already carried by static styling (status stripes, status-dot pulses,
shimmer) are NOT exempt.

The exemption SHALL apply only when idleness is the sole reason to pause. Where
the document is hidden, or the indicator is inside a container marked off-screen,
those pauses SHALL continue to win over the idle exemption — no user is looking
in either case, so the reason for the exemption does not hold. Because the idle
mark is not gated on document visibility, a hidden document can carry both marks
at once; the resulting precedence MUST be pinned rather than left to rule order.

This requirement is complementary to, and does not replace, pausing while the
document is hidden.

#### Scenario: Visible but unattended dashboard pauses animations
- **GIVEN** the dashboard is visible on screen with a selected session card and one or more background sessions streaming
- **WHEN** the user performs no input for the idle delay
- **AND** no operation with an indeterminate progress indicator is in flight
- **THEN** the document root SHALL be marked idle
- **AND** all animations, including background cards' stripes and status dots, SHALL be paused
- **AND** renderer and GPU CPU usage SHALL drop to near-idle

#### Scenario: Any input resumes animations immediately
- **GIVEN** animations are paused because the UI is idle
- **WHEN** the user presses a pointer, presses a key, starts a touch, uses the wheel, or focus enters an element
- **THEN** the idle mark SHALL be cleared
- **AND** animations SHALL resume within one frame

#### Scenario: Idle timer restarts on activity
- **GIVEN** the UI is visible and the user has been interacting
- **WHEN** an input occurs before the idle delay elapses
- **THEN** the idle mark SHALL NOT be applied
- **AND** the delay SHALL restart from that input

#### Scenario: Pointer movement and auto-scroll do not defeat the pause
- **GIVEN** the dashboard is visible with a session streaming and auto-scrolling
- **WHEN** the pointer rests over the window emitting micro-movements and scroll events are dispatched by auto-scroll, with no deliberate input
- **THEN** the document root SHALL still be marked idle after the delay
- **AND** animations SHALL be paused

#### Scenario: An in-flight operation's spinner keeps animating while idle
- **GIVEN** a long-running operation is in progress and shows an indeterminate progress indicator
- **WHEN** the user performs no input for the idle delay
- **THEN** the document root SHALL be marked idle
- **AND** decorative animations SHALL be paused
- **AND** the indeterminate progress indicator SHALL continue animating, so the operation still reads as in progress

#### Scenario: A hidden document pauses indicators despite the idle exemption
- **GIVEN** an indeterminate progress indicator is animating for an in-flight operation
- **WHEN** the window is hidden and the idle delay subsequently elapses, so the document is marked both hidden and idle
- **THEN** the indicator SHALL be paused
- **AND** the hidden-document pause SHALL take precedence over the idle exemption

#### Scenario: An off-screen indicator stays paused while idle
- **GIVEN** an indeterminate progress indicator is inside a container marked off-screen
- **WHEN** the UI is idle
- **THEN** the indicator SHALL be paused
- **AND** the off-screen pause SHALL take precedence over the idle exemption

#### Scenario: Paused state remains legible
- **GIVEN** animations are paused because the UI is idle
- **WHEN** the user looks at the session list
- **THEN** each session's state SHALL remain distinguishable from its static styling
- **AND** the selected session SHALL remain visually identified by a static selection affordance
