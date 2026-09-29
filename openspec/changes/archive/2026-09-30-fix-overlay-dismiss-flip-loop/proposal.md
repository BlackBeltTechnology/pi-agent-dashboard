# fix-overlay-dismiss-flip-loop

## Why

A route-backed overlay opened from another overlay (`/settings/gateway` → `/tunnel-setup`) could never be left: the first dismiss returned to settings, the second re-opened the tunnel wizard, and so on forever. The launcher was a single slot, and the effect that records launchers treated the *return* to the launcher as a fresh launch from the overlay just left. Every dismiss also pushed a history entry, so browser Back walked the same alternating trail, and returning into the launching overlay dropped the captured underlay (leaving settings then landed on `/` instead of the launching session).

## What Changes

- `lib/nav/overlay-background.ts`: the launcher is a **stack**. Opening an overlay of a different surface pushes the launcher. Arriving on the top launcher's surface pops it (a return is not a launch). This covers dismissal and browser Back. Landing on a base route clears the stack, as before.
- `lib/nav/history-back.ts`: new `returnTo(navigate, target, tracker)`. If the tracked predecessor is the target, it pops via `history.back()`; otherwise it calls `navigate(target, { replace: true })`. It never pushes.
- `App.tsx` `dismissOverlay`: uses `returnTo`, and calls `clearBackground()` only when the dismiss target is a base route (not an overlay), so the underlay survives a return into the launching overlay.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `url-routing`: adds a requirement that nested overlay dismissal unwinds one level per dismiss without cycling, keeps the original underlay, and does not grow browser history.

## Impact

- Client only: `packages/client/src/lib/nav/overlay-background.ts`, `packages/client/src/lib/nav/history-back.ts`, `packages/client/src/App.tsx`.
- No server, protocol or persistence changes. Rollback = revert the three files.

## Discipline Skills

- `systematic-debugging`: root-caused from the `recordLauncher` effect before any fix. The regression tests reproduced the flip first.
- Otherwise none apply: no auth, untrusted input, latency budget, new endpoint or irreversible step.
