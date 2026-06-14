# Design — fix-popover-viewport-flip

## Problem shape

```
  BOTTOM-ANCHORED popovers (StatusBar / composer)
  ┌──────────────────────────────────────────────┐
  │ ✅ ModelSelector       bottom-full + max-h-64 │  hand-rolled
  │ ✅ ThinkingLevelSel.   bottom-full + max-h-48 │  hand-rolled
  │ ✅ CommandInput auto.  bottom-full + max-h-64 │  hand-rolled
  │ 🔴 ChatViewMenu        top-full mt-1 (NO cap) │  drifted from spec
  └──────────────────────────────────────────────┘
  LATENT — down-openers, no cap, can sit low in scroll containers
  ┌──────────────────────────────────────────────┐
  │ 🟡 WorktreeActionsMenu (session-list rows)    │
  │ 🟡 PackageRow actions  (settings list)        │
  │ 🟡 OpenSpecGroupPicker / ThemePicker          │
  └──────────────────────────────────────────────┘
```

Three popovers solved this correctly but each copied the logic. `ChatViewMenu`
was the copy that never landed. The fix is to extract the logic once and adopt
it, so there is a single source of truth.

## The hook

`usePopoverFlip(triggerRef, { open, estimatedHeight?, gap?, threshold? })`

Returns `{ flipUp: boolean, maxHeight: number }`.

Algorithm, on `open===true` and on `resize`/`scroll` while open:

```
rect        = triggerRef.current.getBoundingClientRect()
spaceBelow  = window.innerHeight - rect.bottom - gap
spaceAbove  = rect.top - gap
wantHeight  = estimatedHeight ?? Infinity     // unknown until measured

flipUp = spaceBelow < Math.min(wantHeight, threshold) && spaceAbove > spaceBelow
maxHeight = Math.max(120, flipUp ? spaceAbove : spaceBelow)   // floor so it
                                                              // never collapses
```

- **Default direction is down.** Flip up only when below-space is short AND
  above-space is larger — matches the existing spec ("downward by default;
  flips upward near the viewport bottom").
- **`maxHeight`** is applied as an inline `style.maxHeight` plus
  `overflow-y-auto`, so even the chosen direction can never exceed the screen;
  the list scrolls internally as a last resort.
- **`threshold`** default 200px reuses the figure already written into the
  `chat-display-preferences` spec scenario ("within 200px of the viewport
  bottom"). `gap` default 8px (≈ `mt-1`/`mb-1`).

### Why a hook, not a `<Popover>` wrapper

Each call site already owns its open/close state, click-outside, keyboard
handling, and bespoke inner markup. A wrapper component would force a rewrite of
all of them and risk regressions in unrelated behavior. A hook is additive: a
site adds one ref, one hook call, and toggles two class names — minimal,
surgical, matches the existing hand-rolled shape so the three working popovers
collapse onto it cleanly.

### Why measurement over `IntersectionObserver`

The drifted archived change planned `IntersectionObserver`. Direct
`getBoundingClientRect()` on open is simpler, synchronous (no first-frame flash
of the wrong direction), and is exactly what the three working popovers already
do implicitly via static `bottom-full`. The hook makes that dynamic without an
observer lifecycle. Resize/scroll listeners (passive, attached only while open)
cover the "re-evaluate on resize" scenario.

## Adoption pattern (per call site)

```tsx
const triggerRef = useRef<HTMLButtonElement>(null);
const { flipUp, maxHeight } = usePopoverFlip(triggerRef, { open });
...
<button ref={triggerRef} ...>⚙ View</button>
{open && (
  <div
    style={{ maxHeight }}
    className={`absolute right-0 z-30 w-64 overflow-y-auto ...
      ${flipUp ? "bottom-full mb-1" : "top-full mt-1"}`}
  >
```

The three working popovers drop their static `bottom-full`/`max-h-NN` and read
`flipUp`/`maxHeight` instead — output is identical in their bottom-anchored
position but now correct if ever relocated.

## Risks & mitigation

- **Touching many menus → regressions.** Mitigate: adopt incrementally, one
  component per task, each with a test; verify the 🟡 group actually clips in the
  QA browser harness before changing it (skip any that never overflow).
- **SSR / no `window`.** Client-only bundle; guard `typeof window` defensively
  in the hook anyway.
- **Layout thrash on scroll.** Listeners are passive and only attached while the
  popover is open; the read is a single `getBoundingClientRect` per event.

## Alternatives considered

| Option | Verdict |
|---|---|
| Spot-fix only `ChatViewMenu` | Fixes the screenshot, leaves the duplication + latent 🟡 group. Rejected as it re-creates the drift risk. |
| Adopt `@floating-ui` / portal | Bulletproof but new dependency, portals escape the StatusBar's stacking context, and a full rewrite of every call site's interaction logic. Overkill — there is ample space above every bottom-anchored trigger. |
| `<Popover>` wrapper component | Forces rewrite of click-outside/keyboard/markup at every site. Hook is less invasive. |
