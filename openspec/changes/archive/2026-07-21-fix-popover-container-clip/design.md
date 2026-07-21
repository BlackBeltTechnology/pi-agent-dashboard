## Context

`usePopoverFlip` is the single source of truth for popover flip/clamp. It
measures the trigger's `getBoundingClientRect()` and compares against
`window.innerWidth` / `window.innerHeight`. That is correct only when the
viewport IS the clipping boundary. Inside a nested `overflow-hidden` /
`overflow-auto` pane that is narrower than or offset from the viewport, the
actual boundary is the pane — and the hook is blind to it.

Live-confirmed clipping ancestor for `ChatViewMenu`:
`div.flex.min-h-0.min-w-0.flex-col.overflow-hidden` (the ChatView pane).

## Goals

- Horizontal (and vertical) space decisions honor the nearest clipping boundary
  when one exists; fall back to the viewport when none does.
- Additive, backward-compatible: every existing call site keeps working
  unchanged (default boundary = viewport).
- Fix both proven cases (ChatViewMenu clip-left, ModelSelector clip-right) and
  leave no consumer able to clip in an offset overflow pane.

## Decision 1 — boundary source: explicit `boundaryRef` vs auto-detect

Two ways to give the hook a boundary:

| Option | Pros | Cons |
|---|---|---|
| **A. Explicit `boundaryRef`** | Deterministic; consumer names the exact pane; easy to test | Every affected consumer must thread a ref to the pane |
| **B. Auto-detect nearest overflow ancestor** | Zero per-consumer wiring; fixes latent consumers for free | Walks the DOM on open; "nearest scroll/overflow ancestor" heuristic can pick the wrong element (e.g. the popover's own `overflow-y-auto`, or an unrelated clamp) |

**Chosen: A (explicit `boundaryRef`), with B as an internal fallback only if a
consumer opts in via a flag.** Rationale: the wrong-boundary failure mode of
pure auto-detect is itself a clipping bug, and the popover's own
`overflow-y-auto` wrapper is a real foot-gun for a naive ancestor walk.
`boundaryRef` keeps the decision explicit and unit-testable. The consumer count
is small (≤7) and only the ones inside a pane need the ref.

Signature (additive):

```ts
interface PopoverFlipOptions {
  open: boolean;
  estimatedHeight?: number;
  estimatedWidth?: number;
  gap?: number;
  threshold?: number;
  /** Clipping boundary; when set, space is measured against its rect
      instead of the viewport (BOTH axes). Default: viewport. */
  boundaryRef?: React.RefObject<HTMLElement | null>;
  /** Anchor a consumer prefers to keep. Default "right" (current behavior).
      A "left" consumer stays left-0 unless it genuinely must flip. */
  preferredAnchor?: "left" | "right";
  /** Below this content width, FLIP instead of clamping `maxWidth`
      (so a dense dropdown is never squished below readability). Default 0. */
  minContentWidth?: number;
}
```

Measurement change — **both axes**, boundary or viewport:

```ts
const b = boundaryRef?.current?.getBoundingClientRect();
const leftEdge   = b ? b.left   : 0;
const rightEdge  = b ? b.right  : window.innerWidth;
const topEdge    = b ? b.top    : 0;
const bottomEdge = b ? b.bottom : window.innerHeight;
// horizontal
const spaceRightAnchor = rect.right - gap - leftEdge;     // room extending LEFT
const spaceLeftAnchor  = rightEdge - rect.left - gap;     // room extending RIGHT
// vertical (was innerHeight / 0)
const spaceBelow = bottomEdge - rect.bottom - gap;
const spaceAbove = rect.top - topEdge - gap;
```

When `boundaryRef` is absent, `leftEdge/topEdge = 0` and
`rightEdge/bottomEdge = innerWidth/innerHeight` — byte-for-byte the current
viewport behavior on both axes, so every existing call site is unaffected.

**Preferred-anchor + content-min-width** (resolves the ModelSelector anchor-flip
and squish traps). The existing default `anchorRight = !flipHorizontal` stays
for `preferredAnchor: "right"`. For `preferredAnchor: "left"` the hook inverts:
it keeps `left-0` and only flips to `right-0` when the LEFT-anchor space cannot
fit `estimatedWidth` AND the right side has more room. When the chosen side's
space is below `minContentWidth`, the hook flips to the other side rather than
returning a squishing `maxWidth`; only if neither side fits `minContentWidth`
does it clamp (down to the `MIN_POPOVER_WIDTH` floor) as a last resort.

**Boundary staleness listeners.** Window `resize`/`scroll` do not fire when an
`overflow:auto` boundary pane scrolls internally, nor when a split-pane divider
drag resizes the pane (window size unchanged). When `boundaryRef` is set, also:
(a) attach a `scroll` listener on `boundaryRef.current`, and (b) observe it with
a `ResizeObserver` — both call `measure()`. A `ResizeObserver` on the single
supplied element is NOT the rejected ancestor-walk (Decision 1 option B); it is
scoped to the one boundary the consumer named. Listeners attach only while open
and are torn down on close/unmount, mirroring the existing window listeners.

**Self-boundary dev guard.** In `measure()`, when `boundaryRef.current` contains
(or equals) the popover element, emit a dev-only `console.warn` — the boundary
must be the PANE, never the popover's own `overflow-y-auto` wrapper. Cheap
runtime net for a shared primitive; complements the unit test.

## Decision 2 — ModelSelector: opt into the horizontal axis (left-preserving)

ModelSelector currently calls `usePopoverFlip(triggerRef, { open })` — vertical
only — and hardcodes `left-0` + `width: 20rem`. It can never adapt horizontally.

Naively "mirror ChatViewMenu" is **unsound**: ChatViewMenu is already `right-0`,
so the hook's default `anchorRight=true` is a no-op for it; ModelSelector is
`left-0`, so applying the same default would flip it to `right-0` whenever
`rect.right - gap > 320` (its normal center-left composer position) — a behavior
change even when it already fits, and a NEW mirror clip against the pane's left
edge. And blindly applying `maxWidth` would squish its dense grid (provider
select + filter + rows with cap-icons/context badges) below readability.

Fix, precisely:
- pass `preferredAnchor: "left"` so it stays `left-0` unless it truly must flip;
- pass `estimatedWidth: 320` + `minContentWidth` (≈280, its readable floor) so a
  narrow pane makes it **flip**, not squish;
- **remove the hardcoded `width: "20rem"`** (line ~153) and drive width from the
  returned `maxWidth` (else `maxWidth` never shrinks a fixed `width`); apply the
  returned `anchorRight` class.
- verify the internal layout stays legible at the chosen width; if the grid
  cannot degrade gracefully, prefer flip-only (no clamp) for this consumer.

## Decision 3 — remaining consumers

Route each to the cheapest correct outcome:

| Consumer | Anchor / width | Hook consumer today? | Ref source | Plan |
|---|---|---|---|---|
| ChatViewMenu | `right-0`, w-64 | yes (horiz axis) | `ChatView` owns the pane div → new optional `boundaryRef` prop on ChatViewMenu | + `boundaryRef` (primary fix) |
| ModelSelector | `left-0`, 320px | yes (vertical-only) | rendered in `CommandInput`; composer pane ref drilled from there | Decision 2 (left-preserving) |
| ThinkingLevelSelector | `left-0`, w-32 | yes (vertical-only) | same composer pane as ModelSelector | **NOT immune** — in the ChatView pane; + `boundaryRef`, prove no-clip by test |
| CommandInput slash/file | `left-3 right-3` | yes (vertical-only) | n/a | document immunity (dual-edge pins both composer edges) + code comment |
| CommandInput attach / interrupt | `left-0 w-56` / `right-0` | **NO — hardcoded `bottom-full`, no hook** | composer pane | **convert to hook consumers** only if a clip is reproducible; that conversion IS a behavior change (adds flip/clamp), scoped explicitly — else document current no-clamp state |
| ThemePicker | `left-0`, header | yes (vertical-only) | n/a | document immunity (full-width header, no narrow pane above) |
| WorktreeActionsMenu | `right-0`, min-w-140 | yes (vertical-only) | session-card rail pane | + `boundaryRef` (rail can be narrow+offset) |
| PackageRow | `right-0`, min-w-160 | yes (vertical-only) | pi-resources list pane | + `boundaryRef` (list can be in narrow pane) |

**Ref wiring is not free** (both reviewers flagged it): none of these components
receive a pane ref today. Each needs its *parent* (ChatView, the composer, the
session-card rail, the resources list) to `useRef` the clipping pane div and pass
it as a new optional prop. That optional internal prop is not a runtime/API
change. Where a parent is >1 hop away, prefer a small React context over deep
drilling.

## Risks / trade-offs

- **Wrong boundary** → a `boundaryRef` at the popover's own `overflow-y-auto`
  wrapper would clamp against itself. Mitigation (both): a unit test asserts
  boundary ≠ popover element, AND the dev `console.warn` self-boundary guard
  fires at runtime.
- **Boundary moves after open** → window `resize`/`scroll` alone is INSUFFICIENT
  (an internally-scrolling pane or a split-divider drag fires neither). Mitigated
  by the boundary `scroll` listener + `ResizeObserver` on the supplied boundary
  (see the hook design above); the rect is re-read each `measure()`.
- **Width-clamp squish** → clamping `maxWidth` on a dense dropdown (ModelSelector)
  hurts readability. Mitigated by `minContentWidth` → flip instead of squish.
- **Anchor flip changes behavior** → opting a `left-0` consumer into the horiz
  axis must not silently make it `right-0`. Mitigated by `preferredAnchor`.
- **Over-conversion** → adding `boundaryRef` to a structurally-immune consumer
  is harmless (viewport fallback) but noisy; document immunity where genuine
  (ThemePicker, CommandInput dual-edge dropdowns) and back it with a test.

## Resolved (were open questions)

- **Vertical axis** → RESOLVED: apply the boundary to BOTH axes (formula above).
  The spec commits to boundary-aware vertical "where applicable"; a short pane
  can clip vertically too, and the symmetric math is cheap. No per-axis opt-out.
- **CommandInput attach/interrupt** → RESOLVED: they are NOT hook consumers
  today; bringing them under the class goal means converting them, scoped in
  Decision 3 and gated on a reproducible clip (no speculative conversion).
