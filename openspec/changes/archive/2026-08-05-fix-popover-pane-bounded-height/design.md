## Context

`usePopoverFlip` is a shared client primitive behind 8 call sites (9 consumer surfaces — see
Decision 10). It measures a trigger rect and
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

The opt-in for a non-default floor lives INSIDE the consumer component, not at its mount site — so a
new host that re-mounts an enumerated consumer inherits both bounds and cannot forget the floor. This
is what made surface 9 (Decision 10) correct on arrival.

### Decision 10: The launch-dialog run-config row is a 9th consumer SURFACE, not a 9th call site

`#404` (`88c1537e`, merged into `develop` after this change was written) added
`components/openspec/useOpenSpecRunConfigRow.tsx` — a shared "Runs with" row in the Explore / Propose /
New Change dialogs. Audited on rebase:

| Audit question | Finding |
|---|---|
| New `usePopoverFlip` call site? | **No.** Grep confirms the call-site count is still 8. The row re-mounts `ModelSelector` + `ThinkingLevelSelector`. |
| Does it get both bounds? | **Yes, inherited.** Both components apply `minHeight`+`maxHeight` internally, so the new mount gets them for free. |
| Does its host provide a boundary? | **Yes.** `#404` mounts `PopoverBoundaryProvider` with `containerRef.current?.closest('[role="dialog"]')` — which resolves to the shared `Dialog` panel (`packages/client-utils/src/Dialog.tsx:83-91`, `max-h-[80vh] overflow-y-auto`), a real clip+scroll container that contains the trigger. |
| Does it need the 260 opt-in? | **No.** `ModelSelector` sets `minPopoverHeight: LIST_POPOVER_MIN_HEIGHT` internally; `ThinkingLevelSelector` keeps the 120 default. Correct at this surface too. |

So the new surface needed **no source change** — the contract composed correctly. But a dialog panel is
the shortest host in the app (`max-h-[80vh]`, often much less), which makes it the surface where the
260px floor is *most* likely to exceed the available space. That is precisely the overflow mechanism
Decision 1 removed, and it was previously untested. It is now pinned by three tests in
`components/__tests__/OpenSpecRunConfig.test.tsx`, including a deliberate contrast case asserting that
without the dialog ancestor the same rects yield the viewport-derived `440px` instead of the
pane-derived `192px` — so the boundary assertion cannot silently rot into a tautology.

Lesson recorded: the consumer enumeration is a **moving target**. It is a point-in-time fact that
goes stale whenever a new surface mounts an existing popover, and it is not protected by the type
system. The enumeration table now lives in the spec (surface → call site → floor) so the next audit
has an explicit list to diff against.

### Decision 6: The floor is a per-consumer option defaulting to 120; only filterable list popovers opt into 260

Resolved during implementation from measured content heights (task 1.3). A global 260px floor is wrong:
today **no** consumer has a rendered `min-height` at all (120 was only a floor on `maxHeight`), so any
global floor is new visible behavior, and the short fixed menus would render dead space.

| Consumer | Natural content | Under a global 260 floor |
|---|---|---|
| `ModelSelector` | filterable, long | correct — the reported defect |
| `CommandInput` composer dropdown | filterable list | correct |
| `ChatViewMenu` | ~20 rows | no-op (always taller) |
| `ThinkingLevelSelector` | 6–7 rows ≈ 180px desktop | ~80px dead space |
| `ThemePicker` | 4 rows ≈ 112px | ~148px dead space |
| `WorktreeActionsMenu` / `PackageRow` | 3–5 item menus | oddly tall |

Chosen: `PopoverFlipOptions.minPopoverHeight`, default `MIN_POPOVER_HEIGHT = 120` (the existing
constant, unchanged), with `ModelSelector` and the `CommandInput` composer dropdown passing 260. The
spec's "configured floor (≈260px)" is therefore the *configured* value at the list-like call sites, not
a global constant.

### Decision 7: `maxHeight` is clamped at 0

`maxHeight = availableSpace` can be negative when the trigger is scrolled outside the pane in both
directions. A negative CSS `max-height` is invalid and ignored by the browser, yielding an *unbounded*
popover — the exact failure this change removes. `maxHeight = Math.max(0, space)` is not a floor in the
spec's sense (it never inflates `maxHeight` above the available space when that space is real) and it
keeps the bound valid in the degenerate case.

### Decision 8: The Settings `overflow-y-auto` panes are siblings, not nested

Resolved during implementation (task 1.1). `SettingsPanel.tsx:835` and `:858` are the two branches of a
ternary, not a nesting. `:835` is the resource-grid tab and hosts no `usePopoverFlip` consumer; `:858`
is the pane for every other settings page and is where `ModelSelector` (`:1126`) renders. `:858` is the
clip boundary; nothing is redundant.

### Decision 9: Two of the four planned provider mounts were already covered; one boundary-less consumer was not immune

Resolved during implementation (tasks 5.2 / 5.4 / 5.6) by reading the actual host tree:

| Planned | Reality | Action |
|---|---|---|
| Wrap the `App.tsx` composer host (5.2) | `sessionDetail`'s chat is passed as `SessionSplitView`’s `chat` prop → `SplitWorkspace`, which already wraps it in `PopoverBoundaryProvider value={chatPaneRef}` (`split-chat-pane`) | none — already bounded |
| Wrap the `ComposerSessionActions` host (5.4) | Not a host: it is a flex action row with no scroll pane, mounted only at `App.tsx:1734` inside that same already-bounded chat column | none — already bounded |
| Wrap `DirectoryHomeView` (5.3) | `directory-home` is a real `overflow-auto` pane hosting the focal `CommandInput` | wrapped |
| Wrap the Settings pane (5.1) | `SettingsPanel.tsx:858` | wrapped |

So the *only* missing provider mounts were Settings and DirectoryHomeView; the chat surface's real
defect was Decision 1's floor inflation, not a missing boundary.

The immunity audit (5.6) also split by axis. `ThemePicker` stays immune — its sole mount is the
SessionList **header bar**, a sibling above that view's scroll list (its old comment claiming the
"settings header" was stale and is corrected). `CommandInput:376` is NOT immune: `left-3 right-3` pins
both composer edges so it is immune **horizontally**, but it applies a height bound and an offset pane's
bottom edge sits above the viewport's — it now consumes `boundaryRef`.

### Decision 11: Harness qualification — what was proved in-browser, and the one surface that was not

Qualified in this worktree's OWN docker harness (own derived port from `.pi-test-harness.json`, never
`:8000`), rebuilt from source. Overlay mode fails on this host (`cannot mount overlay read-only`, exit
32), so the documented `TEST_COPY_MODE=1` fallback was used; container source confirmed to carry the
change and the served bundle confirmed to contain `h({flipUp,maxHeight,minHeight,anchorRight,maxWidth})`.

Measured, viewport 760×600 (pane 760×480 — deliberately slim AND short):

| Surface | Result |
|---|---|
| Settings pane, trigger 24px above the pane bottom | Flipped up. `minHeight 120px`, `maxHeight 427.17px`, rendered 120px, `insidePane: true`. Pane `scrollHeight` **16515 → 16515 unchanged** — no second scrollbar, no stretch. |
| `PackageRow` ⋮ menu (3 items) | 120px — the default floor is effectively a no-op; not oddly tall, confirming Decision 6 against a global 260. |
| `ThemePicker` (boundary-less, viewport-measured) | `min-height: 120px; max-height: 753px`, rendered 262px — content-driven strictly between the bounds, inside the viewport, no inner scrollbar. |

**Gap, stated plainly:** surface 9 (#404's launch-dialog run-config row) could NOT be exercised in the
harness. Its dialogs (`Explore`/`Propose`/`New Change`) only mount from session actions, and session
spawn yields 0 sessions in the harness — seeded credential markers are not live provider credentials.
The board's own "New proposal" dialog is a different, simpler name+group dialog that does not host the
run-config row. Surface 9's qualification therefore rests on the four jsdom tests in
`components/__tests__/OpenSpecRunConfig.test.tsx`, which assert the pane-derived bound (`192px`), the
floor capped onto it (`minHeight === maxHeight === 192px`), both bounds present on both popovers, and
the contrast case proving a missing boundary yields the viewport-derived `440px`. That is strong
evidence for the arithmetic and the wiring, but it is NOT rendered-layout evidence: jsdom has no
layout, so the no-second-scrollbar invariant is unverified *specifically inside a dialog panel*. The
reachable surfaces above verify it for scroll panes. Closing this properly wants a Playwright spec
driving a real dialog once the harness can spawn a session.

One process note: an early probe reported ThemePicker's `min-height` as `0px`, which looked like a
missing bound. It was a racy probe — reading the popover before React committed the measured state.
Re-read cleanly it is `120px`. Recorded because the first reading was wrong, not the code.

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
