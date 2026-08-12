## Context

The replay-in-flight pill shipped in `show-replay-in-flight-indicator` (#458,
`736c1d269`). Its behaviour — when the flag arms, when it clears, the 300ms
show-delay, skeleton exclusivity — is correct and covered by 22 passing
assertions. What shipped unexamined is its **presentation**: position relative to
sibling overlays, surface contrast, and motion.

Current state (`ChatView.tsx:1432-1444`):

```
absolute bottom-4 right-4 z-10
bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]
px-3 py-1 rounded-full shadow-lg
<Icon mdiLoading className="animate-spin text-[var(--text-secondary)]" />
<span className="text-[11px] text-[var(--text-secondary)]">
aria-label={…}  // duplicates the visible text verbatim
```

Sibling overlays in the same stacking context:

| Overlay | Position | z |
|---|---|---|
| scroll-to-top | `top-4 left-1/2 -translate-x-1/2` | `z-10` |
| scroll-to-bottom | `bottom-4 left-1/2 -translate-x-1/2` | `z-10` |
| **replay pill** | `bottom-4 right-4` | `z-10` |

Constraints: the `data-testid` / `role` / `aria-busy` contract is pinned by the
spec and depended on by `tests/e2e/replay-in-flight-pill.spec.ts`; the transcript
is virtualized, so the indicator must stay an absolutely-positioned sibling and
never become a list row.

## Goals / Non-Goals

**Goals:**

- The pill can never obstruct another interactive control, at any width.
- The pill's boundary meets WCAG 2.1 SC 1.4.11 (3:1) in both themes.
- Motion is suppressed under `prefers-reduced-motion`, matching the six
  reduced-motion blocks `index.css` already ships.
- The existing test/ARIA contract survives byte-for-byte.

**Non-Goals:**

- Variant C (the full-width tail band). It is the stronger reading of "anchored
  to the bottom of the message list" and is recorded in `mockups/ui-plan.md`, but
  it is a visual redesign of a surface that just shipped. Out of scope here.
- Changing when the pill arms/clears, the 300ms delay, or any server behaviour.
- Restyling the scroll controls, which share the same low-contrast surface. Real,
  but pre-existing and separately scoped.

## Decisions

### D1 — Separate by vertical layout, not by paint order

Move the pill to `bottom-16 right-4` and raise it to `z-20`.

The scroll-to-bottom button occupies y=16..48px from the container bottom
(`bottom-4`, 32px tall). `bottom-16` places the pill at y=64px+, clearing it by
16px — one spacing step, consistent at every width because neither element's
vertical position depends on viewport width.

*Alternatives rejected:*

- **Move the pill to `bottom-4 left-4`.** Still collides: at 375px the pill spans
  x=16..202 and the centred button x=171.5..203.5. Horizontal repositioning
  cannot solve a conflict with a *centred* element on a narrow viewport.
- **Hide the scroll-to-bottom button while the pill shows.** Removes a control
  precisely when the user most needs it — new content is arriving at the bottom.
  Trades one Nielsen #1 violation for a worse one.
- **Raise `z-index` only.** The pill would still cover the button; z-order
  decides who is *visible*, not who is *reachable*. Occlusion is the defect.

The `z-20` bump is deliberate on top of the move: it makes the stacking
relationship explicit so a future edit to either element's position cannot
silently reintroduce a paint-order-dependent overlap.

### D2 — A dedicated `--border-strong` token, not a text token pressed into service

Restyle to `bg-[var(--bg-surface)]` + `border-[var(--border-strong)]`, label and
icon to `--text-primary`.

Measured against the transcript background (`--bg-primary`):

| | dark | light |
|---|---|---|
| shipped fill `--bg-tertiary` | 1.19:1 ✗ | 1.14:1 ✗ |
| shipped border `--border-subtle` | ~1.42:1 ✗ | ~1.42:1 ✗ |
| `--bg-surface` fill | 1.38:1 | 1.32:1 |
| **`--border-strong` hairline** | **5.01:1 ✓** | **4.48:1 ✓** |

**A fill alone cannot carry this.** To reach 3:1 against `#0a0a0a` the fill needs
relative luminance ≥0.11 — around `#5c5c5c`, a light-grey blob in a dark
transcript. The boundary must therefore come from a border, and no existing
border token qualifies: `--border-secondary` is 1.57:1 dark / 1.61:1 light.

This **amends the proposal**, which stated no new token would be introduced. The
values I measured are `--text-tertiary`'s (`#808080` / `#777777`), and reusing
that token would need no new definition — but it is a *text* token, and using it
for a border encodes a coincidence of hex values as if it were intent. The
theme-system rule is explicit: a surface needing a token that does not exist gets
it added to the theme layer first. `--border-strong` is defined in both `:root`
and `[data-theme="light"]`, and the scroll controls can adopt it later.

Text contrast is untouched by all of this — it already measures 7.69:1 dark /
8.55:1 light and passes AA. On `--bg-surface` with `--text-primary` it becomes
11.39:1 / 13.18:1. **Nothing about the label needs "fixing".**

`shadow-lg` stays for depth in the light theme but is no longer load-bearing;
over a near-black background a shadow contributes no contrast.

### D3 — Suppress rotation in CSS, keep the element visible

Add a `prefers-reduced-motion: reduce` block to `index.css` that zeroes the
animation on the pill's spinner, alongside the six existing blocks. The pill
still renders and `role="status"` still announces, so the status reaches the user
without motion — reducing motion must not reduce information.

CSS rather than a JS media-query hook: it matches how the repo already handles
this, costs no render, and responds live to an OS-level change.

### D4 — Drop the redundant `aria-label`

The `aria-label` duplicates the visible text verbatim, so it overrides identical
content for no benefit. The accessible name comes from the content. `data-testid`,
`role`, and `aria-busy` are untouched, so the spec contract and the e2e selectors
still hold.

### D5 — Geometry is asserted in Playwright, classes in vitest

**jsdom has no layout engine — every `getBoundingClientRect()` returns zeros.** A
vitest component test therefore *cannot* prove non-occlusion; an overlap
assertion there would pass vacuously and be worse than no test.

So the coverage splits:

- **vitest (L1)** — the pill carries the expected position/stacking/token
  classes, and the reduced-motion rule exists. A proxy for the real property.
- **Playwright (L3)** — at a 375px viewport, assert the two bounding boxes do not
  intersect and the scroll-to-bottom button is clickable while the pill shows.
  This is the only level where the actual defect is observable.

## Risks / Trade-offs

- **`--border-strong` defined in only one theme block** → light theme silently
  falls back to an invalid value and the border disappears. Mitigation: a vitest
  assertion that both `:root` and `[data-theme="light"]` define it.
- **A vacuous non-occlusion test** (the failure mode D5 exists to prevent) →
  Mitigation: land the Playwright assertion against the *unfixed* pill first and
  watch it fail, before applying the position change.
- **`bottom-16` collides with something added later at bottom-right** → nothing
  occupies that region today; the `z-20` + explicit spacing make a future
  conflict visible rather than silent.
- **The e2e spec may assert pill position or a shipped class** → audit
  `tests/e2e/replay-in-flight-pill.spec.ts` before editing; its current selectors
  are `data-testid`-based and expected to survive.
- **A heavier-looking pill** — `--bg-surface` plus a visible hairline is more
  prominent than the near-invisible shipped chip. That is the point: an indicator
  that cannot be seen is not an indicator. The 300ms delay still keeps it off
  screen for fast replays.

## Migration Plan

Client-only. No protocol, schema, server, or persisted-state change; no
migration or coordinated deploy. Ships as a normal client build
(`npm run build` + restart). Rollback is a plain revert of the commit — the
pill returns to its shipped appearance with no residue, since nothing
persists any of these values.

## Open Questions

None blocking. One deferred: whether to later adopt variant C (the tail band),
which would resolve the spec's "anchored to the bottom of the message list"
literally and let the scroll controls move with it. Recorded in
`mockups/ui-plan.md`; not decided here.
