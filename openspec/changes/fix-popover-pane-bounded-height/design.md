## Context

`usePopoverFlip` is a shared client primitive behind 8 call sites. It measures a trigger rect and
returns `flipUp` / `maxHeight` / `anchorRight` / `maxWidth`. It accepts an optional `boundaryRef`
(supplied via `PopoverBoundaryContext`) to measure against a clipping pane instead of the viewport.

Current state, verified by reading source and by a browser mock of both failing surfaces:

| Fact | Location |
|---|---|
| `PopoverBoundaryProvider` mounted in exactly 1 place | `SplitWorkspace.tsx:112` |
| Call sites reading `usePopoverBoundary()` | 6 of 8 (not `ThemePicker`, not `CommandInput:376`) |
| Floor folded into the clamp | `maxHeight = Math.max(MIN_POPOVER_HEIGHT, space)` |
| Floor value | `MIN_POPOVER_HEIGHT = 120` |
| Existing hook tests | `packages/client/src/hooks/__tests__/usePopoverFlip.test.ts` |

So the six boundary-aware consumers receive `undefined` everywhere except the split chat pane, and fall
back to viewport measurement. Inside an offset scroll pane that over-reports available space, the
popover renders past the pane's `overflow` edge, and — because it is absolutely positioned inside the
pane's scroll content — it *enlarges the pane's scroll extent*, producing a second scrollbar.

A mock ported the hook's arithmetic verbatim and isolated one variable (boundary = viewport vs pane)
across a Settings surface and a chat surface. Measured outcomes:

| Surface | boundary = viewport | boundary = pane |
|---|---|---|
| Settings | 447px tall, grew pane scroll → 2nd scrollbar | 300px, bounded, no 2nd scrollbar |
| Chat (composer at pane bottom) | 447px, opened down, stretched pane → 2nd scrollbar | 298px, flipped up, no 2nd scrollbar |

The mock also confirmed the existing *direction* rule and the entire *horizontal* axis already produce
correct results on both surfaces once the boundary is supplied — narrowing the change surface
considerably.

## Goals / Non-Goals

**Goals:**
- A popover inside a scroll pane never renders past the pane's `overflow` edge.
- An open popover never increases its host pane's scroll extent (no second scrollbar, no stretch).
- Popover height is content-driven within its bound: expands to fit content, floored at a readable
  minimum, capped by available space, inner-scrolling the remainder.
- Raise the readable floor (~120px → ~260px) without that floor ever becoming an overflow mechanism.
- Keep the measure path reflow-free — it runs on window scroll/resize and boundary scroll/resize.

**Non-Goals:**
- Changing the vertical direction rule (downward default; flip up when `spaceBelow < min(needed, 200px)`
  and above has more room). Verified correct on both failing surfaces.
- Changing the horizontal axis (`anchorRight`, `maxWidth`, `preferredAnchor`, `minContentWidth`).
- Migrating popovers to a body-level portal (see Decision 4).
- Touching `ThemePicker` / `CommandInput:376`, the two call sites that pass no boundary. Documented as
  structurally immune; out of scope unless a task proves otherwise.

## Decisions

### Decision 1: Split the floor out of `maxHeight` into a separate `minHeight`

`maxHeight = Math.max(MIN_POPOVER_HEIGHT, space)` is the defect: a floor applied *after* clamping can
exceed the space it was clamped to. Raising the floor to 260 would make this strictly worse — the floor
becomes the dominant overflow source.

Chosen: `maxHeight = space` (a true bound, never inflated) and `minHeight = Math.min(FLOOR, space)`
(a floor that can never exceed the bound). When space < floor, both collapse to `space` and the popover
simply fills the available room.

- *Alternative — keep one value, `clamp(content, min(FLOOR, space), space)`*: requires knowing content
  height in JS (see Decision 2) and collapses two independent concepts into one number, making the
  consumer unable to express "grow to content".
- *Alternative — keep the floor in `maxHeight` and let CSS `overflow` hide the excess*: does not help;
  the oversized box still enlarges the pane's scroll extent, which is the actual user-visible bug.

### Decision 2: Express "expand to fit content" declaratively in CSS, not by measuring content

The mock initially measured natural content height in JS (`maxHeight:none` → read `scrollHeight` →
restore) to compute `clamp(content, floor, avail)`. That forces a synchronous reflow, and the measure
path runs on every window `resize`/`scroll` plus boundary `scroll`/`ResizeObserver` — i.e. layout thrash
on scroll, on every open popover.

It is unnecessary. The popover is already a flex column whose natural height *is* its content height.
Applying both bounds as styles yields the exact desired behavior with zero measurement:

```
height: auto              → natural content height
min-height: minHeight     → floored at the readable minimum (already capped by avail)
max-height: maxHeight     → never exceeds available pane space
inner list: flex-1 min-h-0 overflow-y-auto  → the remainder scrolls inside
```

The browser performs the clamp during normal layout. The hook stays pure rect arithmetic.

- *Alternative — measure content once per open rather than per measure*: still a reflow, still needs
  invalidation when the filtered list changes (the model list filters as you type), and buys nothing
  over letting CSS do it.

### Decision 3: Provision the boundary at each scroll pane, not by walking ancestors in the hook

The hook could discover its clipping ancestor by walking up `getComputedStyle(...).overflow`. Rejected
previously in `fix-popover-container-clip` and rejected again here: an ancestor walk is O(depth) per
measurement, silently picks up unintended panes, and is hard to test. Explicit provisioning at the pane
keeps the boundary a declared, reviewable fact.

Panes to wrap: the Settings scroll pane, and the chat composer hosts outside `SplitWorkspace`
(`App.tsx`, `DirectoryHomeView.tsx`, `ComposerSessionActions.tsx`).

`SettingsPanel.tsx` nests two `overflow-y-auto` elements (lines 835 and 858). The task must determine
which one actually clips the popover and wrap that one; the inner may be redundant. The hook's existing
dev-time guard (`boundary.contains(trigger)`) catches a wrong choice.

### Decision 4: Do not switch to a body-level portal

A portal would escape `overflow` clipping entirely and is what the sibling `popover-positioning`
capability already does. Rejected here as disproportionate: it changes stacking, focus, outside-click
and scroll-tracking semantics for 8 call sites to fix a sizing bug, and would still need pane-aware
sizing so the popover doesn't cover unrelated UI. Revisit only if bounded-in-pane sizing proves
insufficient.

### Decision 5: Consumers must apply `minHeight`; the floor is no longer implicit

Because the floor moves out of `maxHeight`, any consumer that applies only `maxHeight` silently loses
its minimum height. All 8 call sites must be updated to apply both. This is the change's main
regression surface and is why every call site is enumerated as an explicit task rather than "update
consumers".

## Risks / Trade-offs

- **A consumer is missed and loses its height floor** → Enumerate all 8 call sites as individual tasks;
  grep for `maxHeight` from `usePopoverFlip` to confirm none applies it without `minHeight`.
- **Raising the floor to 260px makes small menus oddly tall** → The floor applies to all consumers, but
  small menus (`WorktreeActionsMenu` est. width 140, `PackageRow` 160) are short *menus*, not lists. If
  260 looks wrong for them, make the floor a per-consumer option defaulting to the old 120 and opt the
  list-like popovers (ModelSelector, ThinkingLevelSelector, ChatViewMenu) into 260. Decide from rendered
  output, not in advance.
- **Wrapping the wrong nested pane in Settings** → The hook's dev warning fires when the boundary does
  not contain the trigger; verify in the browser at both nesting levels.
- **Existing hook tests assert the old floor-in-`maxHeight` behavior** → They will fail by design;
  update them to the new contract as part of the change, and add cases for floor-capped-by-space.
- **`minHeight` + `maxHeight` on a flex column could conflict with existing `flex-col` internals** →
  The inner list already carries `flex-1 min-h-0 overflow-y-auto` in `ModelSelector`; confirm the same
  for other consumers before relying on inner scroll.
- **Second-scrollbar regressions are invisible to unit tests** (jsdom has no layout) → Assert the
  contract at the hook level in unit tests, and verify the no-second-scrollbar invariant in the browser
  (Playwright or manual) per surface.

## Migration Plan

Client-only, no persistence or protocol impact. Land the hook contract change and all 8 consumer
updates together — a half-applied change leaves consumers without a floor. Rollback is a straight
revert; no data or config migration.

## Open Questions

- Should the 260px floor be global or per-consumer? Leaning per-consumer default-120 with list-like
  popovers opting in — resolve from rendered output during implementation.
- Which of `SettingsPanel.tsx`'s two nested `overflow-y-auto` panes is the true clip boundary, and is the
  inner one redundant?
- Do `ThemePicker` and `CommandInput:376` (currently boundary-less) need provisioning once panes provide
  boundaries, or does their placement keep them immune as documented?
- Is the flipped-up chat popover overlaying the conversation acceptable UX, or should the composer
  surface reserve space? (Raised by the mock; a UX judgement, not a correctness one.)
