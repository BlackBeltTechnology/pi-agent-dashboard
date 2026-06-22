## Context

Measured drain (live `ps`, idle, 2 sessions, low traffic):

| Process | Role | CPU now | Accumulated |
|---|---|---|---|
| renderer | web UI | ~43% | ~8.3h |
| gpu-process | compositor | ~41% | ~7.75h |

Lock-step renderer+GPU at ~40% each = continuous compositing. Confirmed in source:
- `index.css:339-389` — `@property --neon-angle` animated `0→360deg`, drives two `conic-gradient` layers; `::after` adds `filter: blur(var(--neon-glow-blur))`; both `animation: neon-rotate 13s linear infinite`.
- `index.css:406-409` — `prefers-reduced-motion` guard sets `animation: none` on the ring (inactive unless OS Reduce Motion on).
- `main.ts:284-289` — macOS close → `event.preventDefault(); mainWindow?.hide()`.
- `main.ts:253-257` — `webPreferences` sets no `backgroundThrottling`.
- `TerminalView.tsx:55` — `cursorBlink: true`.

## Two distinct background states

The drain has two separable causes; conflating them leads to the wrong fix.

```
  State A: closed to tray (.hide())          ← the ~8h of accumulated CPU
  ───────────────────────────────────
  document.visibilityState → "hidden"
  FIRES even with occlusion disabled (hide() ≠ occlusion detection)
  → a JS visibilitychange pause handler is SUFFICIENT. No Electron change.

  State B: window open, fully covered by another app
  ───────────────────────────────────
  MacWebContentsOcclusion disabled → NO visibilitychange
  → only re-enabling occlusion / polling catches this.
```

State A is the dominant real-world case (nobody watches a card for 8h). This proposal targets A (pause-on-hidden) + the steady-state cost while visible (cheap ring). State B is explicitly deferred: re-enabling occlusion risks the blank-window-on-restore regression that occlusion is usually disabled to avoid, for a small remaining slice.

## Decision 1 — Pause animations on `visibilitychange`

Add a listener on `document` (`visibilitychange`) plus window `blur`/`focus` that toggles `document.documentElement.classList`'s `app-hidden`. CSS:

```css
:root.app-hidden *,
:root.app-hidden *::before,
:root.app-hidden *::after { animation-play-state: paused !important; }
```

`animation-play-state: paused` freezes the compositor without unmounting anything; resuming on `visibilitychange` → visible restores instantly. Chosen over JS-driven `Animation.pause()` (would need to enumerate every animated element) and over removing the DOM (jarring resume).

Why this works under disabled occlusion: `BrowserWindow.hide()` removes the window from screen, so the renderer's page visibility flips to hidden regardless of the occlusion feature, which only governs the "visible-but-covered" detection (State B).

## Decision 2 — Cheap neon ring via `transform: rotate`

Replace angle-animated gradient with a static gradient + rotated layer:

```
  EXPENSIVE (current)                    CHEAP (target)
  animate @property --neon-angle         static conic-gradient (fixed `from`)
    → conic re-rasterized every frame    + @keyframes { transform: rotate(360deg) }
  + filter: blur() over animated layer   + blur() applied once to a static layer
    → GPU shader every frame             → both layers composite as cached textures
```

Transforms are compositor-only (no layout, no paint, no raster). A static blurred conic gradient rasterizes once and is reused. Net steady-state cost approaches zero while visible. Visual output is equivalent (a rotating multicolor rim + glow). Keep the existing `13s linear infinite` timing and the `prefers-reduced-motion` and `@supports not (conic-gradient)` fallbacks.

Risk: a rotated square pseudo-element can clip corners. Mitigate by sizing the rotating layer to cover the card diagonal (scale up) or rotating a radial/larger gradient box so no transparent corner sweeps into view.

### Implemented refinement (supersedes the simple "rotate the `::before`/`::after`" sketch above)

The card root **cannot** take `overflow: hidden`: it hosts a non-portaled dropdown (`WorktreeActionsMenu`, `absolute top-full/bottom-full`, escapes the card) and the outer glow must extend past the card. So a naively rotated, root-attached masked rim tilts (rotating a wide rounded-rect outline misaligns it), and an oversized rotating glow on the root **bleeds** large colored blobs across the page background on wide cards. Resolution (approved as "Option A"): move each effect onto its own **clipped overlay layer** rendered behind card content; the card root becomes `relative isolate`; the menu and content stay unclipped on the root.

- **Rim** (`.card-ring-fx`, z −1): `overflow: hidden` + `border-radius: inherit` clips an oversized rotating conic to the card's rounded rect; an xor mask on the *static* layer carves the interior, leaving a 1px rim band. The mask is on the non-rotating layer, so the rim shape never tilts — only the colors spin.
- **Glow** (double): two layers — `.card-glow-fx` (z −2, tight `inset:-2px`) and `.card-glow-fx-outer` (z −3, wider `inset:-7px`, ~2× blur, lower opacity). `overflow: hidden` clips the rotating conic so rotation stays contained (no page bleed); `filter: blur` on the *layer* then spreads a soft halo just beyond the card. Two layers read as a double glow border. This replaces the original single `.card-selected-ring::after`.
- **Corner coverage at all angles**: a proportional `200% × 200%` (`2W × 2H`) box shrinks to `2H` wide at 90° and gaps on wide cards (`W ≫ H`). Fix: `container-type: size` on each layer + a `200cqmax` square child (`2 × max(W,H) ≥ √(W²+H²)`), centered via `left/top:50%` + `margin:-100cqmax`. Square covers the diagonal at every rotation angle, for any aspect ratio. Clipped, so the large size adds no bleed.
- **z-order** (under the card's `isolation: isolate`): glow-outer −3 → glow −2 → rim/stripes −1 → content 2 (`.card-selected-ring > * { z-index: 2 }`).

## Decision 3 — Compositor-only card stripes

The running/unread stripes (`index.css:197-252`) animate `background-position`:

```
  PROPERTY            PIPELINE         COST
  background-position  PAINT (repaint)  per-frame repaint, not composited
  opacity              COMPOSITE        ~free
```

`background-position` cannot be promoted to a static composited layer, so every running/unread card repaints each frame. Per element this is cheap (a repeating-LINEAR gradient repaint, far below the conic-gradient re-raster + blur of the ring), but it scales with the number of active cards — many concurrent streaming sessions can rival the single ring.

Fix: carry the static `repeating-linear-gradient` on a `::before`/overlay pseudo-element and scroll it with `@keyframes { transform: translate(...) }` over one tile period, instead of animating `background-position`. Transforms composite without repaint. Keep `card-working-opacity-pulse` (opacity is already compositor-only). Preserve the `prefers-reduced-motion` guard (`animation: none`).

Geometry: translate by exactly one **horizontal** tile period (`28.2843px` = 20√2, across the stripes) so the loop is seamless and the drift is visible (translating *along* the 45° axis would be invisible). **No `background-size`** on the overlay — the repeating gradient fills naturally; a fixed tile that isn't a clean multiple of the 20px diagonal period seams the pattern into harsh bands (the original `.card-working-pulse` carried an explicit `IMPORTANT` warning against `background-size`, which only worked there because that approach animated `background-position`). The overlay is widened one period on each side (`left/right: -28.2843px`) so the translate never reveals a gap, and `overflow: hidden` on the overlay clips the translated tile to the card's rounded rect. Implemented as a dedicated `.card-stripes-fx` overlay (rendered behind content on the `relative isolate` card root, not the card-root background) so the clip never affects the dropdown menu; the state marker class (`card-working-pulse` / `card-unread-pulse` / `card-input-stripes`) stays on the `<li>` and maps to an overlay color class (`.card-stripes-running` / `-unread` / `-input`) via `getCardStripeFxClass`.

ask_user unification (per directive "when asking a question, use the stripes with the question color"): the ask_user state currently uses `card-input-pulse` — a `background-color` tint pulse, both visually inconsistent with the stripe family and a paint-triggering animation. Replace it with `card-input-stripes`, a purple (question color, purple-500 `rgb(168 85 247)`) variant reusing the exact same gradient overlay + transform keyframes as working/unread; only the gradient color differs. All three active states become one cheap compositor-only mechanism: running=yellow, unread=cyan, ask_user=purple. The class is selected in `getCardPulseClass` (`SessionCard.tsx:58`); the widget-bar suppression (`SessionCard.tsx:465`, when a slot owns the prompt) carries over unchanged — just swap the class name.

## Decision 4 — xterm cursor blink off

`cursorBlink: false` in `TerminalView.tsx`, matching `InlineTerminalCard.tsx:43`. Minor (~1-2 repaints/s/terminal) but consistent with "don't paint when idle." Already covered by Decision 1 when hidden; this also removes it while visible+idle.

Note: Decisions 2 and 3 both reduce *visible* steady-state cost; Decision 1 covers all of them while hidden. The stripes and ring are also already disabled under `prefers-reduced-motion`.

## Verification (decisive measurement)

```
1. ps baseline: window visible, a card selected.
   ps -axo pid,%cpu,command | grep PI-Dashboard   # note renderer + gpu %
2. Apply Decision 2; repeat step 1 → renderer+GPU should fall sharply while visible.
3. Hide to tray, wait 60s, repeat → with Decision 1, both → ~0%.
   (Pre-fix control: hide to tray today and confirm it STAYS pegged — proves State A.)
```

## Open question

Does `.hide()` on this Electron version already flip page visibility, or is the window treated as still-visible? If already hidden→paused by Chromium defaults, Decision 1 is redundant for State A and only Decision 2 matters. The pre-fix control in Verification step 3 settles this before implementation.
