## 1. Portal the composer popovers (mirror ModelSelector)

- [x] 1.1 `＋` attach menu → `LayerPortal` + `fixed` from a `triggerRef`
  `usePopoverFlip` rect at `z-popover`; panelRef-first outside-click;
  `visibility` pre-measure guard.
- [x] 1.2 `⋯` overflow menu → same treatment (its own `triggerRef`).
- [x] 1.3 Command / file autocomplete lists → `LayerPortal` + `fixed` at
  `z-popover`, reproducing the `left-3 right-3` full-width via
  `triggerRect`/`maxWidth`; keep flip-up/down.
- [x] 1.4 Remove the four migrated `CommandInput.tsx` entries (`z-10`×2,
  `z-20`×2) from `scripts/z-layer-baseline.json`.

## 2. Tests

- [x] 2.1 L1 (vitest) `CommandInput`: opening the `＋` attach menu renders it
  (portaled) and selecting an item still fires its handler; outside-click
  closes it. Triple: `render <CommandInput>` · click `＋` then an item /
  outside · handler called / menu closed. (test-plan: automated) — home
  `packages/client/src/components/chat/__tests__/*.test.tsx`; exemplar:
  existing `ModelSelector.test.tsx` portal/outside-click assertions +
  any current CommandInput test.
- [x] 2.2 L1 (vitest) `CommandInput`: the slash-command autocomplete opens on
  `/` and Enter/click selects; assert it is portaled (not an absolute child of
  the composer). Triple: type `/` · list appears via portal · select applies.
  (test-plan: automated) — same home.
- [x] 2.3 L1 (vitest) z-layer baseline guard passes with the shrunk baseline and
  no new raw-z in `CommandInput.tsx`. Triple: run the baseline guard · after
  migration · green + baseline count reduced by 4. (test-plan: automated) —
  reuse the existing z-layer guard test/script.
- [x] 2.4 Run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` — TDD:
  see the new assertions fail pre-impl, pass post; no unrelated regressions.

## 3. Manual verification (post-build, before merge)

- [x] 3.1 (test-plan: manual-only) Build client + restart; in a session open the
  `＋`, `⋯` (narrow width), and `/` autocomplete; confirm each floats ABOVE the
  sticky quota usage bar and is not clipped by the chat column.
