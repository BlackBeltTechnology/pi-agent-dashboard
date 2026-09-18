# Portal the remaining composer action popovers (attach / overflow / autocomplete)

## Why

The composer's remaining inline popovers — the `＋` attach menu, the mobile `⋯`
overflow menu, and the slash-command / file autocomplete lists — render as
`position:absolute` children with raw `z-10` / `z-20` inside `CommandInput.tsx`.
They are trapped in the composer's ancestor stacking context and clipped by the
`overflow-hidden` chat column, so they collide with the sticky quota-plugin usage
bar above the composer and spill/clip against unrelated chrome (visible: the
overflow menu's terminal `>_` card overlapping the usage bar).

The `overlay-layering` spec already REQUIRES box-escaping overlays to portal to a
top-level layer root and reference a layer token, and tracks the tolerated
pre-existing violations in a shrink-only baseline
(`scripts/z-layer-baseline.json`). `CommandInput.tsx|z-10` (×2) and
`CommandInput.tsx|z-20` (×2) are on that baseline. This change executes that
backlog — the same treatment #635 applied to the model + thinking-level selectors
— so it changes no requirement: `skip_specs: true`.

## What Changes

- Portal the attach `＋` menu, the overflow `⋯` menu, and the command/file
  autocomplete lists through `LayerPortal`, positioned `fixed` from their
  trigger's `usePopoverFlip` `triggerRect`, at `z-popover`, with panelRef-first
  outside-click handling — mirroring the `ModelSelector` exemplar.
- Remove the four migrated `CommandInput.tsx` entries from
  `scripts/z-layer-baseline.json` (the baseline may only shrink).

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
(none — executes the existing `overlay-layering` portal requirement / baseline
backlog; `skip_specs: true`.)

## Impact

- `packages/client/src/components/chat/CommandInput.tsx` — portal 3 popover
  groups (4 baseline occurrences).
- `scripts/z-layer-baseline.json` — shrink by the 4 migrated entries.
- Tests: `CommandInput` interaction test(s) + the z-layer baseline guard.

## Discipline Skills

- `review-code` — run the inline review before commit once tests pass.

No auth / untrusted-input / secrets / PII / latency-budget surface is touched, so
`security-hardening`, `performance-optimization`, and
`observability-instrumentation` do not apply.
