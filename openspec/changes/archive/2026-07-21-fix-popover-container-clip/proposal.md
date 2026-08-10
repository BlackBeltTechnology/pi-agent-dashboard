## Why

The `⚙ View` popover (`ChatViewMenu`) renders with its labels sliced off in the
desktop board layout — "…il turn", "…ed", "…diffs", "…calls" — checkboxes intact
on the right. Confirmed live in the running dashboard by inspecting the popover's
ancestor overflow chain and reproducing the clip:

- The popover anchors `right-0` and extends leftward.
- Its real clipping boundary is the ChatView pane
  (`div.flex.min-h-0.min-w-0.flex-col.overflow-hidden`), NOT the viewport.
- `usePopoverFlip` decides the horizontal anchor from **viewport** geometry
  (`window.innerWidth`, `getBoundingClientRect`). When the pane is narrower than
  and offset from the viewport (any board / multi-pane / offset column), the
  hook still sees "plenty of room" against the window, keeps `right-0`, and the
  pane's `overflow-hidden` guillotines the label column. Measured: 155px of
  labels clipped in the reproduced board condition.

The active `popover-viewport-positioning` spec already carries "never extend
past the viewport/**container** edge" wording, but the current `usePopoverFlip`
implementation only ever measures the viewport — the container clause was never
honored in code. (Framing note: that clause was added by the July horizontal-flip
change *after* the hook was written, so this is an unmet spec clause, not a
spec-that-predated-the-code gap.)

It is also a **latent class**, not one file. Audit of all 7 `usePopoverFlip`
consumers found ModelSelector one board-interaction away from the mirror bug: a
320px `left-0` dropdown with **no horizontal axis at all**
(`usePopoverFlip(triggerRef, { open })`), which overflows a narrow pane's
**right** `overflow-hidden` edge (reproduced: +15px, scales with trigger
offset). CommandInput's slash/file dropdowns are the safe reference pattern
(dual-edge `left-3 right-3`, immune). ThinkingLevelSelector renders **inside the
same ChatView pane** and is NOT immune. WorktreeActionsMenu / PackageRow are
context-dependent lower risk. **Correction from audit:** CommandInput's attach
(`left-0 w-56`) and overflow/interrupt (`right-0`) menus are **not**
`usePopoverFlip` consumers at all — they are hardcoded `bottom-full` menus with
no flip/clamp; bringing them under the class goal means *converting* them into
consumers, which is scoped explicitly below rather than a free "wire the ref".

## What Changes

- **Teach `usePopoverFlip` a clipping boundary.** Add an optional
  `boundaryRef` (or auto-detect the nearest scrollable/overflow ancestor). The
  horizontal axis (and, for consistency, the vertical axis) SHALL measure
  available space against that boundary's rect instead of `window` when a
  boundary is present, falling back to the viewport when it is not. This honors
  the existing spec's "viewport/container edge" wording.
- **Wire ChatViewMenu to the boundary** so its `right-0`/`left-0` decision
  respects the ChatView pane. Confirmed-clip case → fixed.
- **Opt ModelSelector into the horizontal axis** with a **preserved left
  anchor** — the hook gains a `preferredAnchor` so a `left-0` consumer stays
  left unless it genuinely must flip, so opting in does NOT silently swap its
  default to `right-0` (which would itself introduce a mirror clip and change
  behavior when the popover already fits). Its dropdown flips/clamps against the
  pane with a content-aware minimum width (below which it flips rather than
  squishes the dense provider/model grid). Proven-latent case → fixed.
- **Boundary staleness** — when a boundary is supplied, re-measure on boundary
  `scroll` and on boundary size change (`ResizeObserver`), not only on window
  `resize`/`scroll`; an independently-scrolling pane or a dragged split-divider
  otherwise leaves the open popover clamped to a stale boundary rect.
- **Self-boundary dev guard** — a runtime `console.warn` (dev only) when the
  supplied boundary contains the popover element, catching the foot-gun of
  threading the popover's own `overflow-y-auto` wrapper as its boundary.
- **Audit + convert the remaining consumers** so none can clip in an offset
  `overflow` pane: ThinkingLevelSelector (in the ChatView pane → gets
  `boundaryRef`, proven by test), WorktreeActionsMenu, PackageRow → boundary
  axis; CommandInput slash/file dropdowns → documented immune (dual-edge);
  ThemePicker → documented immune (full-width header); CommandInput
  attach/interrupt → converted to hook consumers if a clip is reproducible, else
  documented with the reason. Each "immune" claim is backed by a test or an
  explicit structural reason, not an unproven assertion.

No behavior change when a popover already fits; no server/runtime/protocol API
changes (internal React components may gain an optional ref prop to receive their
pane boundary — that is an internal prop, not a runtime API); the `boundaryRef`
and `preferredAnchor` params are additive (defaults = viewport + existing
anchor, backward-compatible with every current call site).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities

- `popover-viewport-positioning` — the horizontal (and vertical) axis measures a
  clipping boundary (nearest overflow ancestor) when present, not only the
  viewport; consuming popovers inside an offset `overflow` pane no longer clip.

## Impact

- `packages/client/src/hooks/usePopoverFlip.ts` — add `boundaryRef` +
  `preferredAnchor` + content-min-width options; measure
  `spaceRightAnchor`/`spaceLeftAnchor`/`spaceBelow`/`spaceAbove` against the
  boundary rect (both axes) when supplied; boundary `scroll` listener +
  `ResizeObserver`; dev self-boundary `console.warn`; `.AGENTS.md` sidecar row.
- `packages/client/src/components/chat/ChatViewMenu.tsx` — pass the ChatView
  pane as boundary.
- `packages/client/src/components/settings/ModelSelector.tsx` — opt into the
  horizontal axis + boundary.
- `packages/client/src/components/settings/ThinkingLevelSelector.tsx`,
  `settings/ThemePicker.tsx`, `chat/CommandInput.tsx`,
  `worktree/WorktreeActionsMenu.tsx`,
  `packages/client/src/components/packages/PackageRow.tsx` — audit; convert or
  document immunity. Each consumer that needs a boundary also needs its parent
  (e.g. `ChatView`, the composer, the session-card rail) to create the pane ref
  and pass it in — the ref source is named per consumer in design.md.
- `packages/client/src/hooks/__tests__/usePopoverFlip.test.ts` — boundary-aware
  cases (container narrower than / offset from viewport).
- `openspec/specs/popover-viewport-positioning/spec.md` — via delta.

## Discipline Skills

- `review-code` — non-trivial shared-primitive change touching multiple
  consumers; review before commit.
- `doubt-driven-review` — the boundary auto-detection (nearest overflow
  ancestor) is a subtle decision that affects every popover; stress-test it
  before it stands.
