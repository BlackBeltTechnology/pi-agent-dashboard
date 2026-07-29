# Design — compact session-card details

## State model

`SessionCard` owns a boolean `detailsExpanded` state. It initializes to `false`
for a mounted desktop card. The state is deliberately local: card density is a
view preference, not session data, and must not cause a WebSocket write or
mutate `DashboardSession`.

## Compact surface

The existing header remains the scan surface. A labeled toggle exposes the
details state with `aria-expanded` and controls the details region. Compact
mode keeps non-negotiable attention routing visible outside the controlled
region: errors/retries, user-input indicators, unread state, active-process
summary, and OpenSpec activity badge.

## Expanded region

The toggle controls only the detail subcard region. It contains the existing
OpenSpec, worktree/git, process detail, flows, memory, and generic plugin-action
surfaces in their current order. Existing handlers, plugin slots, and test IDs
inside that region remain unchanged.

## Accessibility

- Use a native `button`.
- Include an explicit accessible label that switches between “Show details” and
  “Hide details”.
- Expose `aria-expanded` and an `aria-controls` reference to the details region.
- Do not make card selection depend on the toggle; the toggle stops propagation
  so expanding does not select another session.

## Compatibility

Mobile keeps its existing simplified layout. Any plugin content rendered in the
hidden desktop region becomes visible when expanded; plugin registration and
slot contracts do not change.
