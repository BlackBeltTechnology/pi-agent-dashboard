## ADDED Requirements

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

This requirement is complementary to, and does not replace, pausing while the
document is hidden.

#### Scenario: Visible but unattended dashboard pauses animations
- **GIVEN** the dashboard is visible on screen with a selected session card and one or more background sessions streaming
- **WHEN** the user performs no input for the idle delay
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

#### Scenario: Paused state remains legible
- **GIVEN** animations are paused because the UI is idle
- **WHEN** the user looks at the session list
- **THEN** each session's state SHALL remain distinguishable from its static styling
- **AND** the selected session SHALL remain visually identified by a static selection affordance
