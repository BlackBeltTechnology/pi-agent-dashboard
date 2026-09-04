# WebGL slab field + glass bands: the visual system of pi-dashboard.dev

Implementation record. The animated WebGL slab field (`site/field.js`) and the translucent "glass" bands over it (`site/index.html`). Built 2026-08-26/27, shipped in commits `c52745af0` + `e305c361b`, live at https://pi-dashboard.dev. Durable design/engineering knowledge — the final model, the constraints that shape it, the numbers behind the decisions. Not a changelog. No OpenSpec change.

## Framing

Originating work: hand-written landing page, one WebGL background fleet with CSS glass overlays. Three rewrites driven by user reports: a "ping-pong" scroll effect, 13 fps on the user's own machine, and WCAG contrast failures over a moving backdrop. This doc records the final scroll model, the placement math, the draw-cost budget, the glass layer stack, the measured contrast work, and the CSS traps the page actually shipped.

## Finding A — scroll drives RATES, never displacements

- Field rewritten THREE times. User kept reporting a "ping-pong" effect.
- Root cause, stated generally: ANY scroll-driven value that is a reversible DISPLACEMENT must undo itself on the way back up — position parallax, flow heading, camera dolly, camera roll, bank angle. That retrace reads as ping-pong.
- `sin(t * rate)` tumble JUMPS whenever `rate` changes.
- Fix: scroll drives rates; angles INTEGRATED per frame (`s.spin += rate * dt`), never sampled from a closed form.
- Final model: scroll accumulates an UNSIGNED energy pool: `energy = Math.min(2.4, energy + Math.min(1, d / 90) * 0.85)`. ~90px saturates one event at 0.85 gain.
- Decay `energy *= Math.exp(-dt * 0.45)` — ~1.5s half-life.
- Energy multiplies per-slab integrated spin rates: yaw `rnd(0.14, 0.38)`, pitch `rnd(0.04, 0.13)`, roll `rnd(0.03, 0.10)`, per-slab `spinResp: rnd(0.45, 1.5)`.
- Camera is pointer-parallax ONLY. Completely deaf to scroll.
- Travel speed constant, one-way wrap.
- Removing the flow/bank trig bought ~5 fps: 30 → 35-39.

## Finding B — homogeneous placement is stratified, not random

- Random placement clumps.
- Sides alternate by index. Each side's slabs occupy one vertical cell across `2*Y_SPAN`, with only ±45% jitter inside the cell: `const y = -Y_SPAN + (slot + 0.5) * cell + rnd(-0.45, 0.45) * cell;`.
- Lateral span and depth use a golden-ratio sequence: `const golden = (i * 0.6180339887) % 1;`. Depth offset by a third turn → x and z decorrelated.
- `Y_SPAN = 24`; `WRAP_Y = Y_SPAN + 3` so the spawn band and the wrap band share a half-height. Without it the first pass is denser than every later one.
- Related bug: stratification read `state.count` while `build()` caps `n` in narrow mode → slabs packed into the bottom half. `makeSlab(i, n)` now takes the real count.

## Finding C — even spacing decays unless per-slab drift variance is TINY

- `driftY` = layer factor × `rnd(0.94, 1.06)`.
- Layer factors: 1.1 near / 0.68 mid / 0.37 far.
- Earlier `rnd(0.5, 1.25)`: fast slabs lapped slow ones; stratification collapsed into clumps within minutes.

## Finding D — accumulating rotation eventually destroys a readable object

- Hero accent card accumulated spin. At t+75s it had rotated into a diamond and stopped reading as a card.
- Now BOUNDED SWAY: `swayA` applied via `sin` of the integrated spin phase; `step()` branches on `s.swayA`.
- Free accumulating tumble on ordinary slabs also drifted them edge-on → read as "flying shards".

## Finding E — draw cost is a standing constraint

- User reported 13 fps on their own machine.
- Cuts: `ExtrudeGeometry` `curveSegments` 10→3, `bevelSegments` 3→1 — roughly a QUARTER of the triangles (comment in source).
- FOUR shared body materials for the whole fleet (`bodyMats = PAL.dark.body.map(...)`), not one per slab.
- Shadows: only near+mid layers cast (`m.castShadow = layer !== 2`); far layer receives only.
- Software-raster benchmark moved ~24 → ~34 fps at the same slab count.
- NO `EffectComposer` / DOF / bloom addons. Bloom would reintroduce the banned AI-glow look. Depth comes from fog, scale, and a slower far layer.
- Reduced motion renders a composed still — 240 headless steps (`for (let i = 0; i < 240; i++) step(1 / 60)`), not a blank page.
- Pauses on `document.hidden`.
- Returns `null` + `console.warn` when WebGL is unavailable. No fallback image, by design.

## Finding F — emissive must be an accent-coloured base at low intensity

- White base at `emissiveIntensity 2.4` clips to a blown-out bar under ACES tonemapping.
- Use `pal.emissive` at ~1.1.

## Finding G — glass bands: three layers, and the ORDER is the trick

- `.glass` layer 1 — translucent tint: `background: color-mix(in srgb, var(--bg-secondary) var(--glass-tint,86%), transparent)`. This is the CONTRAST FLOOR, not decoration.
- Layer 2 — `backdrop-filter: blur(18px) saturate(1.15)`: the baseline every engine supports.
- Layer 3, inside `@supports (backdrop-filter: url(#chroma))`: the SVG filter `#chroma` — blur once (`feGaussianBlur stdDeviation="9"`), isolate R/G/B with three `feColorMatrix` rows, `feOffset` red `dx="-1.4"` / blue `dx="1.4"`, `feBlend mode="screen"` back together, final `feColorMatrix type="saturate" values="1.15"`.
- Chromium + Firefox take the SVG path. Safari parses filter functions but not `url()` there → keeps the plain blur, loses only the fringe.
- TWO non-obvious requirements:
  - `color-interpolation-filters="sRGB"` — the SVG default is linearRGB and silently BRIGHTENS every backdrop.
  - Widened filter region `x="-20%" y="-20%" width="140%" height="140%"` — otherwise the blur fades into transparency at the band edges and leaves a dark seam.
- Chromatic offset kept at ±1.4px — lens-defect scale. Pushed further it stops reading as glass and reads as a broken display (source comment).
- Applied to `.strip` (spec strip) and `#download`.

## Finding H — contrast over a MOVING backdrop must be sampled across frames, and it changed the design

- Method: hide the text runs, screenshot the band, sample the real backdrop pixels inside each text run's box over SIX different field frames, compute the WCAG ratio against the computed text colour.
- ONE frame proves nothing.
- Result: small `.stat-k` labels measured **4.27:1** — under the 4.5 AA floor.
- Raising the tint could NOT fix it: `--text-tertiary` is 4.98:1 even on the OPAQUE background — a label starts with 0.48 of margin and any translucency spends it.
- At 89% tint the next sample measured **4.46** — the noise band straddled the floor. "Usually accessible" is not accessible.
- Fix at the source: small dim type steps up one rung ON GLASS ONLY: `.glass .spec .stat-k, .glass .rel .when, .glass .foot-note { color: var(--text-secondary) }`.
- That bought headroom to make the glass MORE transparent, not less: `--glass-tint` 78% → **74% dark / 70% light**.
- Worst run across both bands and both themes then **7.2:1**.
- Specificity trap on the way: `.glass .stat-k` (0,2,0) lost to the later `.spec .stat-k` (0,2,0) — equal specificity, source order decides.

## Finding I — token contrast floors are annotated in the source and must be obeyed

- `--text-tertiary`: `#808080` (4.98:1) in dark; `#777777` (4.48:1) in light, marked "decorative only".
- Lifting the footer link to tertiary measured 4.48:1 in light = FAIL.
- `--text-secondary`: 9.13:1 dark / 9.74:1 light.
- General rule: a decorative caption may sit at ~2:1; an INTERACTIVE element inside it may not.

## Finding J — cost of the glass, measured, with mitigations

- 44 → **35 fps** at 1440×900 on software raster = 20% frame-rate cost.
- Cause: a full-width `backdrop-filter` is recomputed EVERY frame while the WebGL field animates behind it.
- Mitigation 1: below 720px the bands fall back to the flat tint — `@media(max-width:720px)` → `background: var(--bg-secondary); backdrop-filter: none`. Small screens pay most, and there the bands are tallest relative to the viewport.
- Mitigation 2: `@media (prefers-reduced-transparency: reduce)` disables it entirely (source comment: "Some people ask the OS for less of exactly this. Honour it.").
- Verified on production: at 390px the computed `backdrop-filter` is `none`.

## Finding K — CSS traps this page actually shipped

1. Generic class names collide in a single-file page: the install code-copy rule `.copy { position: absolute }` also matched the hero's `<div class="copy">`, pulling the headline out of flow so the introduction floated under the video. Renamed `.copy-btn`.
2. A blanket stacking rule must SKIP anything already positioned: `body > *:not(#field){position:relative;z-index:1}` came after `header{position:sticky}` with equal specificity and silently killed the sticky header. Now `:not(#field):not(header)`.
3. `<figure>` carries a UA margin of `16px 40px` — `.film` needed `margin: 0` or the hero video insets 40px from the copy.

## Finding L — two-way reveal without retrace

- `.reveal` hidden state: `transform: translateY(var(--rv,34px)) scale(.985)`; transitions `opacity .5s ease` and `transform .72s cubic-bezier(.22,.61,.36,1)`.
- The observer NEVER unobserves. On exit `--rv` is flipped to the sign of `entry.boundingClientRect.top` — `e.target.style.setProperty('--rv', e.boundingClientRect.top < 0 ? '-34px' : '34px')`.
- A block continues in the scroll direction instead of retracing — the same ping-pong lesson as Finding A.
- Only `opacity` and `transform` animate — compositor-only, so it costs the 3D field no frame budget.
- The hidden state MUST be applied by JS at runtime, never in static CSS: the `prefers-reduced-motion` rule kills all transitions (`*{animation:none!important;transition:none!important}`) and would leave the page permanently blank.

## Finding M — responsive header sheds in an explicit ORDER, and an icon changes that order

- Adding buttons overflowed the nav: measured 1133px in a 1024px box.
- Shedding order = what the visitor can least afford to lose.
- After GitHub got its Octocat mark, the order changed:
  1. labels go FIRST — `@media(max-width:1080px)` hides `.btn.ic .lbl` (both of them);
  2. the whole GitHub button — `@media(max-width:860px)`, repeated in the footer;
  3. in-page nav links — `@media(max-width:720px)`, all reachable by scrolling;
  4. the wordmark — `@media(max-width:360px)`.
- Install + theme control never leave.
- Dropping a LABEL beat dropping a DESTINATION: 109px → 41px buys back more width than deleting the link did, and keeps the destination 220px further down.
- Verified 0px overflow at 320/360/390/430/560/720/860/900/1000/1024/1080/1200/1280/1440.

## Finding N — small icons need parts, not silhouettes

- The site's one-path Tux loses beak, feet and belly at 22px and reads as a ghost.
- Redrawn in four parts: body, white front, beak, feet.
- The belly must be a CONSTANT light (`#f3f4f6`), not a theme token: `--bg-secondary` is nearly invisible in light theme; `--bg-primary` reads as a hole punched through the bird in dark.

## Sources

- Repo: `site/field.js` (slab geometry, energy/spin model, shared materials, shadow + reduced-motion handling), `site/index.html` (`.glass` stack + `#chroma` SVG filter, `--glass-tint` tokens, `.reveal`, header media queries, Tux icon).
- Commits `c52745af0`, `e305c361b` (2026-08-26/27).
- Measurements: user frame-rate reports (13 fps), software-raster benchmarks (~24 → ~34 fps fleet-only; 44 → 35 fps with glass), contrast sampling across six field frames per band per theme, viewport overflow checks at 14 widths, production computed-style check at 390px.
