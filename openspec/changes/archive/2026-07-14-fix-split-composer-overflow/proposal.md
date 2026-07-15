# Fix composer toolbar overflow in the split chat pane

## Why

In split view (`SplitWorkspace`), the chat pane is narrow but the **browser viewport
is still wide**. The composer's inner toolbar (`CommandInput.tsx`) folds its secondary
controls — thinking level, the `Steer | Queue` delivery control, and the inline
terminal — into a `⋯` overflow menu using **viewport-based** `md:` breakpoints. Because
the viewport stays ≥ `md`, none of those controls fold: they all render inline.

The full inline toolbar has a measured natural width of **~689px** (`＋` · model chip ·
`high` · `Steer|Queue` · terminal · `after turn` · action button). When the split chat
pane is narrower than that, the row cannot fit. It does not wrap, and the pane carries
`overflow-hidden` (`split-chat-pane`), so the trailing content is clipped:

- the red **stop/send action button** is cut off at the right edge, and
- the **`Steer | Queue`** control (and the `after turn` label) overflow / squash — the
  `after turn` text wraps to two lines under pressure.

Root cause is the responsive axis, not the markup: folding is keyed to the **viewport**
when it must key to the **composer's own width**.

## What Changes

1. **Container-query folding.** The composer card SHALL be a `@container`, and the
   toolbar SHALL fold its secondary controls based on the **container width**, not the
   viewport. Below the fold threshold, thinking / `Steer|Queue` / terminal collapse into
   the existing `⋯` overflow menu; at or above it they render inline exactly as today's
   full-width composer.

2. **Fold threshold above the natural inline width.** The fold breakpoint SHALL sit
   above the ~689px natural inline width (`@[44rem]` ≈ 704px) so that whenever the
   controls are inline they actually fit, and the action button is never clipped. The
   `after turn` label folds to icon-only below `@[30rem]`.

3. **Behaviour parity for real mobile.** On a phone the composer container is also narrow,
   so container-based folding yields the same `＋ · model · ⋯ · send` layout that the
   viewport `md:` rules produced before — no regression to the mobile composer.

## Impact

- Affected specs: `chat-view` (Mobile composer adaptation — folding is now
  container-width driven, not viewport-width driven)
- Affected code: `packages/client/src/components/CommandInput.tsx`
  (add `@container` to `composer-card`; swap `md:`/`sm:` folding classes for
  `@[44rem]:` / `@[30rem]:`)
- No protocol/wire change, no new dependency (Tailwind v4 container queries are built in).
- Verified: repro + fix mockup at
  `openspec/changes/fix-split-composer-overflow/mockups/composer-split-overflow.html`
  (broken 560px, fixed 560/640/900px); 104 `CommandInput` tests pass; production build
  emits `@container (min-width:44rem)` + `(min-width:30rem)`.

## Discipline Skills

- `systematic-debugging` — fix follows a diagnosed root cause (viewport vs container
  width); the natural inline width (689px) was measured before choosing the breakpoint.
- `doubt-driven-review` — the fold threshold is a magic width; verify it sits above the
  measured natural inline width so the inline↔fold transition never leaves an overflowing
  intermediate band.
