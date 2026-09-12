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

- Define the shrinkable rows of `split-chat-pane`, their shrink weights, and each
  row's lower bound.
- Specify below-floor behavior as a deliberate allocation rather than an artifact
  of child order — no row should be the designated victim purely for being last.
- Add height-based regression coverage at each boundary (at the floor sum, just
  below it, and far below it). Today's `tests/e2e/split-composer-overflow.spec.ts`
  only covers horizontal overflow.

## Non-goals

- Re-opening the `40%` composer bound or the `composer-card` scrollport placement.
  Both are settled and pinned by tests; the autocomplete containing-block
  constraint in particular must not be disturbed.

## Priority

**Low.** The band is not reachable in practice — a stacked mobile split on an
`844px` screen gives the chat pane roughly `400px`, against a `~145px` threshold.
This is correctness hygiene for the layout contract, not a user-facing defect.

## Discipline Skills

- `scenario-design` — the deliverable is boundary coverage; the height boundaries
  and their expected allocations are the artifact.
- `review-code` — touches shared chat furniture that several plugins render into.
