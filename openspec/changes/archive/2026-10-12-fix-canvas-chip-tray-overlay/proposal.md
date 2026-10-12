## Why

The canvas chip tray (the server chip, e.g. "Identity topológia — Keycloak :40623",
and the mobile tap-to-open file chip) renders as an in-flow block at the top of
the app layout, above the toolbar. When a chip appears it pushes the header and
toolbar down and breaks page sizing (#681). The cause: `<CanvasDriver>` is mounted as a
bare child of `SplitWorkspaceProvider` in `App.tsx`, so its tray `<div>` joins
the layout flex tree.

## What Changes

- The canvas chip tray renders as a **floating overlay**, portaled to the
  top-level layer root (per `overlay-layering`) and anchored bottom-right just above
  the session composer stack (context strip, status, queue, composer). It is out of
  layout flow, so a chip appearing or disappearing never moves or resizes any other element.
- The overlay follows the composer stack's top edge as it grows (multi-line
  drafts, queue rows, plugin `composer-panel` content) so it never covers it.
  Frozen overlay underlays never anchor it. With no live composer it rests at the
  viewport's bottom-right inset, respecting the safe-area inset.
- The tray sits on the existing `z-overlay` layer: above content, below composer
  popovers, dialogs and toasts. Only the chips themselves take pointer
  input, so chat scrolling and clicks around the tray are not blocked.
- The auto-open effect, the mobile gate and chip tap behaviour are unchanged.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `auto-canvas`: adds a requirement that the chip tray is a non-layout floating
  overlay anchored above the composer.

## Impact

- `packages/client/src/components/canvas/CanvasDriver.tsx` (tray positioning)
- `packages/client/src/App.tsx` (zero-height composer-stack anchor sentinel, passed to `CanvasDriver`; mount point unchanged)
- `packages/client/src/components/canvas/CanvasServerChip.tsx` (label truncation only)
- Tests: `packages/client/src/components/__tests__/CanvasDriver.test.tsx`; a
  browser E2E in `tests/e2e/`
- Client rebuild + restart. No server, protocol or persistence change. Rollback: revert.

## Discipline Skills

None of the `eng-disciplines` checkpoints apply. It touches three client files, with no
auth, untrusted input, latency budget, endpoint or irreversible step. Three
React components are touched (App, CanvasDriver, CanvasServerChip), so the
`react-expert` spawn checkpoint (≥3 components) applies during apply. `review-code` runs at the
standard pre-commit checkpoint.
