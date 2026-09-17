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

Indeterminate progress indicators are the one exception and SHALL keep animating
while idle. Unlike pausing for a hidden document, this pause applies while the
user is looking at the screen, where a frozen spinner misreports an in-progress
operation as a hung one. The exemption SHALL be expressed as a declarative rule
keyed on the shared indicator class, not as a per-component opt-out, so a newly
added indicator inherits it. Decorative liveness animations that merely restate a
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
