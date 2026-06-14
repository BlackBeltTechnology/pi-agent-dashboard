## Why

The `⚙ View` popover (`ChatViewMenu`) opens **off the bottom of the screen**:
its lower rows ("Use global settings", the tool-call toggles) render past the
viewport edge and are unreachable. The menu lives in the bottom `StatusBar`
(moved there by `2026-06-03-relocate-view-menu-to-status-bar`) but still opens
**downward** (`absolute right-0 mt-1`, no measurement).

This is a **spec/code drift, not a missing feature.** The
`chat-display-preferences` spec already carries a requirement
*"Per-session override popover SHALL auto-flip direction"* (added by
`2026-06-11-fix-settings-panel-and-reset`, whose tasks were marked done with a
`flipUp` + `IntersectionObserver` implementation). But `git log` shows
`ChatViewMenu.tsx` was **only ever touched by the original `configurable-chat-display`
commit** — the flip code was never committed. The shipped code does not match
its own accepted spec.

A wider audit of every client popover found the same hazard latent elsewhere.
Three bottom-anchored popovers (`ModelSelector`, `ThinkingLevelSelector`,
`CommandInput` autocomplete) each **hand-rolled** the "open upward + cap height"
fix independently. A second group opens downward with **no height cap** and can
sit low in scroll containers (`WorktreeActionsMenu` in session-list rows,
`PackageRow` actions in the settings list), clipping the same way. The root
cause is one missing primitive duplicated three times and forgotten a fourth.

## What Changes

- **Restore the specced auto-flip on `ChatViewMenu`** so it matches the existing
  `chat-display-preferences` requirement. Fixes the reported bug.
- **Introduce a shared `usePopoverFlip` hook** (`packages/client/src/hooks/`) that
  measures the trigger rect on open + on resize/scroll, returns a `flipUp`
  boolean and a clamped `maxHeight`, so a popover renders upward when it would
  overflow the viewport bottom and never exceeds available space on either edge.
- **Adopt the hook in the drifted + latent-risk popovers**: `ChatViewMenu` (the
  bug), and the uncapped down-openers that can sit low in scroll containers —
  `WorktreeActionsMenu`, `PackageRow`, `OpenSpecGroupPicker`, `ThemePicker`.
- **Refactor the three already-working bottom-anchored popovers**
  (`ModelSelector`, `ThinkingLevelSelector`, `CommandInput`) to use the shared
  hook, retiring their duplicated hand-rolled flip logic. Behavior unchanged;
  this removes the copy-paste that let `ChatViewMenu` drift in the first place.

**Out of scope:** `TasksPopover` (centered `fixed inset-0` modal, immune),
top-anchored header menus with short lists where downward never clips
(`AddToWorkspaceMenu`, `WorkspaceHeader`, `ServerSelector`, `SessionHeader`,
`MobileActionMenu`), and any change to display-preference semantics, the WS
protocol, or persistence.

## Capabilities

### Added Capabilities

- `popover-viewport-positioning`: A shared client hook guaranteeing any
  viewport-anchored popover flips direction and caps its height to stay fully
  on-screen, with a defined default direction, flip threshold, and re-evaluation
  triggers.

### Modified Capabilities

- `chat-display-preferences`: No requirement text changes — the existing
  *"Per-session override popover SHALL auto-flip direction"* requirement is
  brought back into compliance. (Listed for traceability; the spec delta
  re-affirms it pointing at the shared hook.)

## Impact

**Code touched:**
- `packages/client/src/hooks/usePopoverFlip.ts` — new shared hook + tests.
- `packages/client/src/components/ChatViewMenu.tsx` — adopt hook; swap
  `top-full mt-1` ⇄ `bottom-full mb-1`; add `max-h` + `overflow-y-auto`.
- `packages/client/src/components/WorktreeActionsMenu.tsx`,
  `PackageRow.tsx`, `OpenSpecGroupPicker.tsx`, `ThemePicker.tsx` — adopt hook.
- `packages/client/src/components/ModelSelector.tsx`,
  `ThinkingLevelSelector.tsx`, `CommandInput.tsx` — replace hand-rolled flip
  with the shared hook (no behavior change).
- Tests: hook unit tests (mock `getBoundingClientRect` / `innerHeight`); update
  affected component tests asserting flip class + `max-h`.

**Not touched:** `TasksPopover`, top-anchored header menus, `DisplayPrefs`
schema, `setSessionDisplayPrefs` WS message, server persistence.

**Open question (verify in implementation):** whether the latent-risk group
truly clips today (depends on list length + scroll position) — confirm with the
QA browser harness before adopting, to avoid touching menus that never overflow.
