## Why

When the session a user is currently viewing transitions to `status === "ended"` — most commonly after a dashboard server reload, a pi process crash, or the bridge disconnecting — the chat panel freezes in place with no in-context way to bring the session back. The Resume / Fork affordance lives only on the sidebar `SessionCard` (and inside the mobile kebab menu), so the user must navigate back to the sidebar, locate the card, click Resume, and re-navigate to `/session/:id`. This breaks flow for what is the single most common post-reload action.

## What Changes

- Surface a **Resume** + **Fork** button pair in the desktop `SessionHeader` toolbar when `session.status === "ended"` AND `session.sessionFile` is set.
- Replace the dimmed elapsed-time text with the button pair when ended (the elapsed timer is meaningless on a tombstone session, and the slot avoids cluttering the always-on toolbar).
- Reuse the existing `handleResumeSession(id, mode)` plumbing already wired through `App.tsx` for the sidebar card — no new server contract, no new WebSocket message, no new state.
- Mirror the sidebar card's exact visual language (green Resume pill, blue Fork pill, `mdiPlayCircleOutline` / `mdiSourceFork` icons) for zero learning curve.
- Disable both buttons while `session.resuming === true` to prevent double-spawn during the in-flight respawn window.
- Mobile is unchanged — the existing `MobileActionMenu` already exposes Resume via `mobileActions.onResume`.

## Capabilities

### New Capabilities
<!-- None — this is a UI surface addition, not a new capability. -->

### Modified Capabilities
- `session-resume`: adds a requirement that the desktop session content header SHALL also expose Resume + Fork affordances when the viewed session is ended and has a stored session file. Existing protocol, server behavior, and sidebar affordances are unchanged.

## Impact

- **Code**: `packages/client/src/components/SessionHeader.tsx` (add `onResume` prop + conditional render). `packages/client/src/App.tsx` (thread the existing `handleResumeSession` callback into the desktop `SessionHeader` — currently only passed to `mobileActions`).
- **APIs**: None. The `resume_session` WebSocket message and `/api/session/:id/resume` REST endpoint are reused as-is.
- **Tests**: One new component test asserting the buttons render iff `status === "ended" && sessionFile`, are disabled while `resuming`, and invoke `onResume("continue")` / `onResume("fork")` on click.
- **Accessibility / mobile**: No regressions — mobile path untouched, desktop adds keyboard-reachable buttons with `title` tooltips matching the sidebar card.
- **Risk**: Low. The buttons are read-only-visible until clicked; clicking calls a code path that is already exercised by the sidebar card and the mobile kebab menu in production.
