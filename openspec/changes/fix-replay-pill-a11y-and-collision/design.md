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

- Put the indicator where the missing content lands, satisfying the spec's
  "anchored to the bottom of the message list" literally.
- The indicator can never obstruct another interactive control, at any width.
- The label's boundary meets WCAG 2.1 SC 1.4.11 (3:1) in both themes.
- Motion is suppressed under `prefers-reduced-motion`, matching the six
  reduced-motion blocks `index.css` already ships.
- The existing test/ARIA contract survives byte-for-byte.

**Non-Goals:**

- Changing when the indicator arms/clears, the 300ms delay, or any server
  behaviour.
- Reserving list space for the indicator. It stays an overlay — see D2.
- Restyling the scroll controls, which share the same low-contrast surface. Real,
  but pre-existing and separately scoped.

## Decisions

### D1 — A tail scrim plus a centred label; nothing moves conditionally

The indicator becomes two elements:

- a **scrim** — `absolute inset-x-0 bottom-0`, ~112px tall, a gradient from
  `--bg-primary` at the bottom to transparent at the top, `pointer-events-none`,
  `aria-hidden`;
- a **label** — `absolute bottom-16 left-1/2 -translate-x-1/2 z-20`, carrying the
  existing testid/role/aria-busy contract.

The scroll controls **keep their resting position**. The label sits at 64px, the
scroll-to-bottom button occupies 16..48px: 16px of clearance, at every width,
because neither position depends on the viewport. Verified in the mockup —
375px and 1440px, both themes, zero box intersection.

*Alternatives rejected:*

- **A full-width band at `bottom-0` that pushes the scroll button up while it
  shows** (the first C draft). It works, but the button then *jumps* when the
  replay ends. A control that moves under the user's finger is a worse defect
  than the one being fixed, and it makes the button's position a function of
  replay state — a coupling with no upside.
- **Permanently raising the scroll button** to clear a bottom-anchored band.
  Static, but it changes an unrelated control's resting position in the ~99% of
  time no replay is running, to serve the ~1% when one is.
- **Keeping the corner chip and merely moving it** (variant B, the previously
  specced scope). Cheaper, and it does fix occlusion and contrast — but it
  leaves the indicator in a corner, which is what made the spec's "where the
  not-yet-delivered events will land" only approximately true.

### D2 — The scrim overlays; it must not reflow, and must not intercept input

The scrim is `pointer-events-none`. It covers a strip of transcript, and without
that it would silently swallow text selection and clicks over the last message —
a regression invisible to any test that only asserts rendering.

It must **not** be implemented as bottom padding on the list. Padding would
reflow the transcript, which the spec forbids and which the virtualizer's scroll
anchoring is sensitive to (`fix-chat-scroll-race-during-replay`,
`fix-chat-scroll-to-top-estimate-drift` both exist because of this).

**Accepted cost:** the scrim veils the bottom edge of the last message while
showing. That is the trade for placing the affordance at the tail, and it is
visible in the mockup. It is bounded — the content is dimmed by a gradient, not
hidden; it only applies while a replay is genuinely in flight; and the 300ms
delay keeps it off screen entirely for fast replays. The premise of the feature
is that the tail is *incomplete*, so softening the tail edge is arguably honest
rather than merely tolerable.

### D3 — A dedicated `--border-strong` token, not a text token pressed into service

The label uses `bg-[var(--bg-surface)]` + `border-[var(--border-strong)]`, with
icon and text at `--text-primary`.

Measured against the transcript background (`--bg-primary`):

| | dark | light |
|---|---|---|
| shipped fill `--bg-tertiary` | 1.19:1 ✗ | 1.14:1 ✗ |
| shipped border `--border-subtle` | ~1.42:1 ✗ | ~1.42:1 ✗ |
| `--bg-surface` fill | 1.38:1 | 1.32:1 |
| **`--border-strong` hairline** | **5.01:1 ✓** | **4.48:1 ✓** |

**A fill alone cannot carry this.** To reach 3:1 against `#0a0a0a` the fill needs
relative luminance ≥0.11 — around `#5c5c5c`, a light-grey blob in a dark
transcript. The boundary must come from a border, and no existing border token
qualifies: `--border-secondary` is 1.57:1 dark / 1.61:1 light.

This **amends the proposal**, which originally stated no new token would be
introduced. The values I measured are `--text-tertiary`'s (`#808080` /
`#777777`), and reusing that token would need no new definition — but it is a
*text* token, and using it for a border encodes a coincidence of hex values as if
it were intent. The theme-system rule is explicit: a surface needing a token that
does not exist gets it added to the theme layer first. `--border-strong` is
defined in both `:root` and `[data-theme="light"]`, and the scroll controls can
adopt it later.

Text contrast is untouched: it already measures 7.69:1 dark / 8.55:1 light and
passes AA. On `--bg-surface` with `--text-primary` it becomes 11.39:1 / 13.18:1.
**Nothing about the label needs "fixing".**

### D4 — Suppress rotation in CSS, keep the element visible

Add a `prefers-reduced-motion: reduce` block to `index.css` that zeroes the
animation on the indicator's spinner, alongside the six existing blocks. The
label still renders and `role="status"` still announces, so the status reaches
the user without motion — reducing motion must not reduce information.

CSS rather than a JS media-query hook: it matches how the repo already handles
this, costs no render, and responds live to an OS-level change.

### D5 — Drop the redundant `aria-label`; the scrim is not announced

The `aria-label` duplicates the visible text verbatim, so it overrides identical
content for no benefit. The accessible name comes from the content.
`data-testid`, `role`, and `aria-busy` are untouched.

The scrim is decorative and carries `aria-hidden="true"`: it must not add a
second node to the accessibility tree for one status.

### D6 — Geometry is asserted in Playwright, classes in vitest

**jsdom has no layout engine — every `getBoundingClientRect()` returns zeros.** A
vitest component test therefore *cannot* prove non-occlusion; an overlap
assertion there would pass vacuously and be worse than no test.

So the coverage splits:

- **vitest (L1)** — the scrim and label carry the expected position/stacking/token
  classes, the scrim is `pointer-events-none` and `aria-hidden`, both render and
  clear together, and neither renders beside the skeleton. Proxies for the real
  properties.
- **Playwright (L3)** — at a 375px viewport, assert the label and scroll-to-bottom
  bounding boxes do not intersect and the button is clickable while the indicator
  shows. The only level where the actual defect is observable.

## Risks / Trade-offs

- **The scrim veils the last message** → accepted and bounded; see D2.
- **`--border-strong` defined in only one theme block** → light theme silently
  falls back to an invalid value and the border disappears. Mitigation: a vitest
  assertion that both `:root` and `[data-theme="light"]` define it.
- **Scrim without `pointer-events-none`** swallows selection and clicks over the
  tail — and renders identically, so screenshots would not catch it. Mitigation:
  an explicit vitest assertion on the class, called out as its own task.
- **A vacuous non-occlusion test** (the failure mode D6 exists to prevent) →
  Mitigation: land the Playwright assertion against the *unfixed* indicator first
  and watch it fail on box intersection.
- **Two elements that must arm and clear as one** — a scrim left behind after the
  label clears would permanently dim the transcript tail. Mitigation: both are
  driven by the single existing `showReplayPill` condition, with a test asserting
  they appear and disappear together.
- **The e2e spec may assert the old position or the removed `aria-label`** →
  audit `tests/e2e/replay-in-flight-pill.spec.ts` before editing; its current
  selectors are `data-testid`-based and expected to survive.

## Migration Plan

Client-only. No protocol, schema, server, or persisted-state change; no
migration or coordinated deploy. Ships as a normal client build
(`npm run build` + restart). Rollback is a plain revert of the commit — the
indicator returns to its shipped appearance with no residue, since nothing
persists any of these values.

## Open Questions

None. Variant B (restyle the corner chip in place) was the previously specced
scope and is superseded by this document; it remains recorded in
`mockups/ui-plan.md` as the cheaper alternative if the scrim's cost to the tail
proves unacceptable in use.
