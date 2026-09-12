# Define a below-floor height allocation rule for the chat pane

## Why

`fix-quota-widget-clipping` fixed the reachable defect: the chat pane now budgets
its height so the composer cannot starve the rows below it, and nothing clips from
`pane=457` down to `pane=160`.

It deliberately did **not** define what happens once the pane is shorter than the
sum of its rows' minimum heights. Measured behavior in that band (mobile A/B at
`390×844`):

```
pane:     150 145 140 135 130
clipped:    0   1   6  11  13
```

The transcript holds at its floor, the bounded composer holds at its own minimum,
and the entire remaining shortfall is clipped off the **bottom-most row** by the
pane's `overflow: hidden` boundary. There is no weighted distribution — the last
row absorbs all of it, which is why the quota bar was the original symptom.

Raised by CodeRabbit on PR #627 as a Major functional-correctness finding. The
shipped spec now *describes* this behavior honestly rather than claiming
proportional degradation, but describing it is not the same as endorsing it.

## What Changes

- Classify every row of `split-chat-pane` as **shrinkable** (owns a scrollport, so
  losing height hides content behind a scrollbar) or **fixed** (would paint over
  its neighbour instead), and give the shrinkable rows declared weights and lower
  bounds. This covers the conditional rows the current layout never accounted for:
  the `content-header-sticky` slot wrapper, `SessionBanner`, `QueuePanel`, the
  transcript's error-boundary fallback, and `StatusBar` (which is itself null when
  idle) — each inflates the floor sum whenever it renders.
- Declare the transcript floor explicitly. `ChatView` carries no `min-height`
  today; the `16px` floor observed in the measurements is emergent, so any rule
  written against "the transcript floor" is currently written against nothing.
- Specify below-floor behavior as a deliberate ordering rather than an artifact of
  child order: nothing is clipped while a scrollable row still has height to give.
  The original symptom — the quota bar clipped while the transcript sat comfortably
  — is exactly what that forbids. Residual clipping after the scrollable rows
  bottom out remains, declared rather than accidental; removing it entirely needs a
  JS allocator this change deliberately does not take on (see `design.md`
  Decision 1).
- Add height-based regression coverage at each boundary (at the floor sum, just
  below it, and far below it). Today's `tests/e2e/split-composer-overflow.spec.ts`
  only covers horizontal overflow.

## Non-goals

- Re-opening the `40%` composer bound or the `composer-card` scrollport placement.
  Both are settled and pinned by tests; the autocomplete containing-block
  constraint in particular must not be disturbed.

## Priority

**Medium.** The band is reachable, contrary to the original read. The default
stacked mobile split on an `844px` screen gives the chat pane roughly `400px`,
but `RATIO_MIN = 0.25` (`packages/client/src/lib/layout/split-state.ts:18`) lets
the user drag the divider down to a quarter of the content area — about `140px`
on a `667px` phone, inside the measured clipping band. Every conditional row that
renders (banner, queue panel, sticky header contribution) raises the floor sum and
widens the band further. Not a default-state defect, but not unreachable either.

## Discipline Skills

- `scenario-design` — the deliverable is boundary coverage; the height boundaries
  and their expected allocations are the artifact.
- `review-code` — touches shared chat furniture that several plugins render into.
