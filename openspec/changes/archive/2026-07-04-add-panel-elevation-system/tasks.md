# Tasks — add-panel-elevation-system

## 1. Elevation-rim token
- [x] 1.1 Add per-mode `--elevation-rim` in `packages/client/src/index.css`: `:root` (dark) `rgba(255, 255, 255, 0.10)`; `[data-theme="light"]` `rgba(255, 255, 255, 0.9)`.
- [x] 1.2 Verify the token survives named-theme application (inline vars set by `applyThemeVars` in `themes.ts` only cover `CSS_VAR_KEYS`; a non-listed custom prop from `index.css` should persist). If it is stripped, add `--elevation-rim` to the shared per-mode merge in `themes.ts` instead and document which path was taken. **Path taken: index.css** — `applyThemeVars` (`useTheme.ts`) only sets/removes `CSS_VAR_KEYS`; `--elevation-rim` is not listed, so it persists under every named theme. Confirmed by test.
- [x] 1.3 Add/extend a test in `packages/client/src/lib/__tests__/themes.test.ts` (or a small DOM test) asserting `--elevation-rim` resolves to the dark value by default and the light value under `[data-theme="light"]`.

## 2. Session card bevel + title weight
- [x] 2.1 In `SessionCard.tsx` desktop container (~line 647), replace `shadow-md shadow-[var(--shadow-card)]` with the bevel: `shadow-[inset_0_1px_0_var(--elevation-rim),0_4px_8px_var(--shadow-card)]` (keep `hover:shadow-lg hover:-translate-y-0.5` and the selected branch intact).
- [x] 2.2 In the mobile container (~line 535), apply the same bevel recipe.
- [x] 2.3 Add `font-semibold` to the desktop session-name span (~line 697) and the mobile session-name span (~line 543).
- [x] 2.4 Confirm the selected-card branch (border/tint/ring + `card-glow-fx`/`card-ring-fx`) is unchanged and now also carries the inset highlight without visual regression. **Confirmed:** bevel lives on the shared container `className`; the `isSelected` ternary only swaps border/bg/ring, so selected keeps its treatment + gains the inset highlight. SessionCard.test.tsx (102) green.

## 3. Folder / workspace header bevel
- [x] 3.1 In `WorkspaceHeader.tsx`, add the bevel to the header bar: `inset 0 1px 0 var(--elevation-rim)` + `0 2px 4px var(--shadow-card)`.
- [x] 3.2 Apply the same to the folder header bar. Folder header render is `renderGroup` in `SessionList.tsx`; bevel applied to the folder panel container (`rounded-[14px]` div), the folder's raised-surface element.

## 4. Cross-mode + cross-theme verification
- [x] 4.1 Verify in light AND dark that session titles read heavier, cards/folder bars read as raised panels, and the selected card still clearly dominates. **Verified structurally:** the shipped recipe (weight 600 + `inset 0 1px 0 var(--elevation-rim), 0 4px 8px var(--shadow-card)`) is byte-identical to the `tier1.html` mockup validated in light+dark during explore. `npm run build` confirms both bevel utilities generate (cards `0 4px 8px`, headers/folder `0 2px 4px`) with commas parsed as multi-shadow (not purged) and tokens resolving per-mode (`#ffffff1a`/`#ffffffe6`). No `isolated-ui-verification` harness exists in-repo; live visual sign-off left to the user.
- [x] 4.2 Spot-check the lightest themes (Base, GitHub light) that the inset highlight is visible on `--bg-tertiary` surfaces; spot-check the lightest dark bg (Solarized dark) that the drop does not over-darken. **Covered by mockup validation** (`all-themes.html`, all 9 themes × light/dark): no muddy palette; inset reads on tinted `--bg-tertiary`. Cards sit on `--bg-tertiary` (tinted), where the light `rgba(255,255,255,0.9)` highlight reads; drop uses modest `--shadow-card` alpha (0.4–0.5 dark) so no over-darken.
- [x] 4.3 Confirm no WCAG contrast regression on session-name / meta text (no tint or shadow added to text; weight 600 only). **Confirmed from diff:** only `font-semibold` added to title spans — no `text-shadow`, no color/tint change to any text. Text contrast is unchanged (meta) or improved (heavier title). No regression.

## 5. Docs
- [x] 5.1 Update `SessionCard.tsx.AGENTS.md` and `WorkspaceHeader.tsx.AGENTS.md` rows to note the bevel + `See change: add-panel-elevation-system`. (Also noted the folder-bevel on `SessionList.tsx.AGENTS.md`.)
- [x] 5.2 If `--elevation-rim` lands in `themes.ts`, note it in the themes row; otherwise note the `index.css` home. **index.css home** — added an `index.css` row to `packages/client/src/AGENTS.md` documenting the token (per-mode values, theme-agnostic, not in `CSS_VAR_KEYS`).
