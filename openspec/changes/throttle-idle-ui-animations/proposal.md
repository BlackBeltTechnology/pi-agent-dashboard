## Why

PI Dashboard burns ~one full CPU core continuously while idle. Live `ps` on a MacBook (Apple Silicon) showed the Electron renderer at ~43% and the GPU process at ~41%, moving in lock-step — the signature of continuous per-frame compositing — with only 2 low-traffic sessions connected. Accumulated CPU time was ~8h renderer / ~7.75h GPU, draining battery for a UI nobody was watching.

Root cause is structural, not load-driven:

1. The selected session card runs an always-on, GPU-expensive neon glow border (`.card-selected-ring`, `packages/client/src/index.css:339-389`): two `conic-gradient` layers whose angle is driven by an animated registered custom property `@property --neon-angle`, and the `::after` layer applies `filter: blur()` over that gradient. Animating the gradient angle forces the gradient to be **re-rasterized every frame** (it cannot be cached as a static composited layer), and the per-frame `blur()` is one of the most expensive GPU operations available. This runs `13s linear infinite` — forever — and a selected card is essentially always present.
2. Nothing pauses animations when the window is not visible. On macOS, closing the window only hides it to the tray (`packages/electron/src/main.ts:284-289` calls `mainWindow.hide()`, not quit), so the neon ring keeps painting for hours in the background — this explains the ~8h accumulation.

The existing `prefers-reduced-motion` guard (`index.css:406-409`) is the only escape hatch and is inactive unless the user manually enables macOS Reduce Motion.

## What Changes

- **Pause all CSS animations when the document is hidden.** Add a `visibilitychange`/`blur`/`focus` listener that toggles an `app-hidden` class on the document root, with CSS that sets `animation-play-state: paused` on all elements and pseudo-elements while hidden. `document.visibilityState` flips to `hidden` when the window is hidden to the tray via `.hide()` even with Chromium occlusion detection disabled, so this kills the dominant background-drain case (tray-hidden for hours) without touching Electron occlusion flags.
- **Make the neon selected-card ring cheap while visible.** Replace the animated `@property --neon-angle` (which re-rasterizes the conic gradient every frame) with static conic gradients rotated via `transform: rotate()` — compositor-only, never re-rasterized. The crisp rim (`.card-ring-fx`) and a double glow (`.card-glow-fx` + wider `.card-glow-fx-outer`) live on dedicated overlay layers behind card content (the card root is `relative isolate`), each `overflow: hidden`-clipped so the rotation stays contained to the card; `blur()` is applied to the clipped layer once and cached (no per-frame blur). The card root itself cannot take `overflow: hidden` — it hosts a non-portaled dropdown menu (`WorktreeActionsMenu`) and the outer glow must extend past the card — so the clip lives on these inner layers, not the root. Each rotating layer is sized `200cqmax` (a square ≥ the card diagonal) so the gradient covers the full card width at every rotation angle, including the 90° phase where a proportional box would gap on wide cards.
- **Make the running/unread card stripes compositor-only while visible.** The `card-working-pulse` / `card-unread-pulse` stripes (`index.css:197-252`) animate `background-position`, a paint-triggering property that forces a per-frame repaint of every running/unread card (cheap per element, but it scales with the number of active cards). Replace the `background-position` scroll with a `transform: translateX` on a `.card-stripes-fx` overlay layer carrying the static repeating gradient — transforms composite without repaint. The overlay carries no `background-size` (the gradient fills naturally; a fixed tile that isn't a clean multiple of the 20px/45° period seams the stripes) and translates by exactly one horizontal period (`28.2843px`) for a seamless loop. The overlay is `overflow: hidden`-clipped to the card. Keep the `opacity` pulse (already compositor-only).
- **Unify the ask_user (waiting-for-question) state onto the same stripes, in the question color (purple).** Today ask_user uses `card-input-pulse` (`index.css:256-262`), a `background-color` tint pulse — visually inconsistent with running (yellow stripes) and unread (cyan stripes), and a paint-triggering property. Replace it with a purple variant of the compositor-only stripe overlay (`card-input-stripes`), reusing the shared transform keyframes; color (purple-500) is the only difference, exactly as unread reuses working's geometry.
- **Stop the xterm cursor blink in `TerminalView`** (`cursorBlink: true` → `false`), matching `InlineTerminalCard` which already uses `false`. Removes a per-second repaint per open terminal tab.

Out of scope: re-enabling `MacWebContentsOcclusion` / setting `backgroundThrottling`. That only addresses the secondary "window open but covered by another app" case, carries a known blank-window-on-restore regression risk, and is unnecessary once animations pause on `visibilitychange`.

## Capabilities

### New Capabilities
- `ui-animation-energy`: idle/hidden-state energy discipline for the web client — animations MUST pause when the document is hidden, and decorative infinite animations MUST avoid per-frame rasterization/blur in steady state.

### Modified Capabilities
<!-- none -->

## Impact

- `packages/client/src/hooks/useAppHidden.ts` (NEW) — `useAppHidden()` hook + `applyAppHiddenClass(root, hidden)`; toggles `app-hidden` on the document root from `document.visibilityState` (listens `visibilitychange` + window `blur`/`focus`; cleans up on unmount).
- `packages/client/src/hooks/__tests__/useAppHidden.test.ts` (NEW) — asserts the class toggles with visibility.
- `packages/client/src/App.tsx` — calls `useAppHidden()`.
- `packages/client/src/index.css` —
  - add `:root.app-hidden *, ::before, ::after { animation-play-state: paused !important }`;
  - remove `@property --neon-angle` + angle keyframe; neon rim on `.card-ring-fx` overlay (overflow:hidden + xor mask → rotating conic clipped to a 1px rim band) and double glow on `.card-glow-fx` / `.card-glow-fx-outer` overlays (overflow:hidden clips the rotating conic, `filter: blur` on the layer spreads a soft contained halo); both rotate via the shared `neon-rotate` `transform: rotate` keyframe and are sized `200cqmax` (`container-type: size` on the layers); remove the old `.card-selected-ring::after` glow;
  - stripes on `.card-stripes-fx` overlay + color classes `.card-stripes-running` / `.card-stripes-unread` / `.card-stripes-input`, scrolled via `transform: translateX(28.2843px)` (`card-stripe-scroll`), no `background-size`; remove `.card-input-pulse` tint keyframes;
  - z-order under the card's `isolation: isolate`: glow-outer −3, glow −2, rim/stripes −1, content 2.
- `packages/client/src/components/SessionCard.tsx` — `getCardPulseClass` returns `card-input-stripes` for ask_user (state marker stays on the `<li>`); new `getCardStripeFxClass` maps marker → overlay color class; card `<li>` gains `relative isolate` and renders the glow / stripe / rim overlay layers behind content (desktop card renders the neon-ring + glow layers when selected; both desktop and mobile render the stripe overlay). Suppression comments at lines 52, 465 updated.
- `packages/client/src/components/__tests__/SessionCard.test.tsx` — ask_user assertions updated from `card-input-pulse` to `card-input-stripes`.
- `packages/client/src/components/TerminalView.tsx` — `cursorBlink: false`.
- No API, server, protocol, or dependency changes. Client-only. No Electron main-process change.
- Verification requires before/after `ps` readings (renderer + GPU %) in two window states (visible-with-selected-card, hidden-to-tray).
- Mockup: `mockups/idle-ui-animations/index.html` — self-contained preview of the new compositor-only ring + stripes (all card states, dark/light, `app-hidden` pause toggle). Open with `open mockups/idle-ui-animations/index.html`.
