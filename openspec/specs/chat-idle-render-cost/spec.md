# chat-idle-render-cost

## Purpose

Ensure an open chat session page that is receiving no events and no input performs no continuous layout or paint work. Decorative and liveness animations run compositor-only and are gated by viewport visibility and active state, while preserving reduced-motion behavior.

## Requirements

### Requirement: Idle chat page performs no continuous layout work

An open chat session page that is receiving no session events and no user input SHALL NOT run continuous style-recalculation or layout passes. Decorative and liveness animations MUST NOT animate layout-affecting CSS properties (`width`, `height`, `top`, `left`, margins, paddings) or paint-heavy properties (`background-color`, `color`, `box-shadow`, `background-position`) on the main thread; they SHALL be implemented compositor-only (`transform`, `opacity`, including opacity cross-fades of pre-painted layers).

#### Scenario: Quiet long session tab is layout-idle
- **WHEN** a session with a long transcript is open, no WebSocket events arrive, and the user provides no input for a sustained period (≥ 10 s)
- **THEN** a performance trace of that window SHALL show approximately zero layout passes per second attributable to the page's own animations (budget: < 5 layouts/s, vs. the measured 85/s baseline)

#### Scenario: No non-composited animations reported
- **WHEN** Chrome's animation instrumentation inspects the running animations on the chat page
- **THEN** no page-owned animation SHALL be flagged as non-composited due to unsupported properties (`width`, `background-color`, `color`, `box-shadow`, `background-position-x`)

### Requirement: Liveness animations are gated by visibility and state

Animations that signal live activity (tool-group shimmer, spinner pulse, streaming-bubble glow, decorative card FX) SHALL run only while (a) the animated element is within or near the viewport, and (b) the state they signal is actually active. Off-screen or completed elements MUST NOT keep animations running.

#### Scenario: Off-screen animation paused
- **WHEN** an element carrying a liveness or decorative animation scrolls out of the viewport
- **THEN** its animation SHALL be paused (e.g. `animation-play-state: paused` via a shared IntersectionObserver) and SHALL resume when the element re-enters the viewport

#### Scenario: Completed state stops its animation
- **WHEN** a tool group finishes (running → done) or a streaming bubble stops streaming
- **THEN** the associated shimmer/pulse/glow animation SHALL stop (element unmounted or animation removed), not merely become invisible

#### Scenario: Reduced motion preserved
- **WHEN** the user has `prefers-reduced-motion: reduce`
- **THEN** the existing reduced-motion behavior (animations stripped, static text/icons) SHALL remain unchanged by the gating mechanism
