## 1. Tests first (red)

- [x] 1.1 Add `packages/client/src/__tests__/selected-card-fx-css.test.ts` (CSS source-scan idiom from `fx-idle-css.test.ts`): assert `.card-glow-mask` rule carries `mask-composite: exclude` + `-webkit-mask-composite: xor` + content-box mask; `.card-glow-mask` is in the `position: absolute` override block declared after `.card-selected-ring > *`; `--neon-rim-width: 3px` in `:root`; `.card-ring-fx` uses `var(--neon-rim-width)` for inset + padding; light block has `--neon-rim-alpha: 0.75`, `--neon-glow-alpha: 0.30`, `--neon-glow-opacity: 0.65`; dark `--neon-glow-alpha: 0.10` unchanged; `@supports not` hides `.card-glow-mask`; no mask declared on `.card-glow-fx::before` / `.card-ring-fx::before` (rotating elements).
- [x] 1.2 Add a render test (SessionCard desktop, `isSelected`): each `.card-glow-fx` has a `.card-glow-mask` parent; `.card-ring-fx` present; unselected card renders none of them; all are `aria-hidden`.
- [x] 1.3 Run the new tests; confirm they fail.

## 2. Implementation

- [x] 2.1 `index.css`: add `--neon-rim-width: 3px` to `:root`; set `--neon-rim-alpha: 0.75` in `:root` and light block; light `--neon-glow-alpha: 0.30`, `--neon-glow-opacity: 0.65`. Update comments with `See change: fix-selected-card-light-wash`.
- [x] 2.2 `index.css`: `.card-ring-fx` → `inset: calc(-1 * var(--neon-rim-width)); padding: var(--neon-rim-width);`.
- [x] 2.3 `index.css`: add `.card-glow-mask` (inset -6px / padding 6px, z -2) and `.card-glow-mask-outer` (inset -14px / padding 14px, z -3) with the content-box xor mask; re-inset the inner glows so they sit inside the wrapper band (inner `inset:4px`, outer `inset:7px` relative to wrapper — keeps today's visual extent); move z-index from `.card-glow-fx*` to the wrappers; add `.card-glow-mask` to the `position:absolute` override block.
- [x] 2.4 `index.css`: `@supports not (conic-gradient)` → hide `.card-glow-mask` instead of `.card-glow-fx`.
- [x] 2.5 `SessionCard.tsx`: wrap the two `.card-glow-fx` divs in `.card-glow-mask` / `.card-glow-mask card-glow-mask-outer` wrappers (`aria-hidden`).
- [x] 2.6 Run 1.1 / 1.2 → green; run the full client suite (`npm test`), tee to `/tmp/pi-test.log`.

## 3. E2E + visual verification

- [x] 3.1 `tests/e2e/ui-token-alignment.spec.ts`: extend the glow/rim exclusion selector to `.card-glow-mask` if the scrollWidth check trips.
- [x] 3.2 (Static check: descendant selector still matches through the wrapper; E2E not run — needs docker harness.) `tests/e2e/idle-fx-pause.spec.ts`: confirm `.card-glow-fx::before` play-state assertions still pass.
- [x] 3.3 (Verified via `npm run build` + static render of the BUILT `index-*.css` with real card classes, light+dark — port 8000 runs the installed app, not this checkout.) Build + restart (`npm run build && curl -X POST http://localhost:8000/api/restart`); screenshot selected card in light + dark; confirm clean interior, 3px rim, visible outside halo, no rail/drag-bead collision.

- [x] 3.4 `SessionList.tsx` list `<ul>` gains `pr-4`: the `overflow-y-auto` scroller clipped the 14px outside halo on the right (8px `p-2` gutter).
- [x] 3.5 Desktop selected card drops the `--tint-blue-bg` fill → `--bg-primary` (rim carries the signal; mobile keeps the blue fill — no rim there).
- [x] 3.6 Real clipper was `.group-collapse > * { overflow: hidden }` (folder 0fr collapse), flush with the card's right edge. Clip box extended horizontally: `padding-right: 14px; margin-right: -14px` (content width unchanged; no vertical padding so 0fr collapse still reaches 0). Verified in a live Playwright probe: every clipping ancestor ≥14px right of the card.

## 4. Docs

- [x] 4.1 Update `packages/client/src/components/session/SessionCard.tsx.AGENTS.md` and `packages/client/src/AGENTS.md` (index.css row) with the `.card-glow-mask` wrapper + `See change: fix-selected-card-light-wash`.
- [x] 4.2 Test files referenced from the `index.css` row + `SessionCard.tsx.AGENTS.md` (`__tests__/` dirs carry no `AGENTS.md` by convention).

## 5. Manual QA

- [ ] 5.1 Light + dark, all four themes: select a card with OpenSpec + Git sections; verify accent text legibility and that `#tag` chips are out of scope (tracked separately).
- [ ] 5.2 `prefers-reduced-motion: reduce` → rim/glow static but visible.
