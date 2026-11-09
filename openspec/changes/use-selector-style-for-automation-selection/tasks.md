# Tasks — use-selector-style-for-automation-selection

## 1. Selected-card style

- [ ] 1.1 In `packages/automation-plugin/src/client/AutomationBoard.tsx`, remove the three selected FX `<div>`s and the `GLOW_FX_CLASS` / `GLOW_FX_OUTER_CLASS` / `RING_FX_CLASS` imports
- [ ] 1.2 Add `aria-current="true"` to the selected card root `<li>` (none when unselected)
- [ ] 1.3 Give the header row `-mx-3 -mt-3 px-3 pt-3 pb-1.5 bg-[var(--accent-soft)]` when selected; keep the body on `--bg-secondary`
- [ ] 1.4 Switch the name button to `font-bold` when selected (`font-semibold` otherwise)
- [ ] 1.5 Reword the `overflow-hidden` comment and the file header doc comment (no more "neon glow + rim")

## 2. Visuals module

- [ ] 2.1 Delete `GLOW_FX_CLASS`, `GLOW_FX_OUTER_CLASS` and `RING_FX_CLASS` from `packages/automation-plugin/src/client/automation-card-visuals.ts`; confirm no other importer in `packages/automation-plugin`

## 3. Tests

Test tasks are folded from `test-plan.md` (the manifest). Each names its harness exemplar, its triple (input · trigger · observable) and its manifest row.

- [ ] 3.1 Selected card uses the selector style (test-plan #E1), extending `packages/automation-plugin/src/__tests__/AutomationBoard.test.tsx` (see its F7 stripe test for the render + query glue): board with automations a, b · click `automation-def-a` · a has `aria-current="true"`, `border-[var(--accent)]`, a header row with `bg-[var(--accent-soft)]`, a `font-bold` name, and no `HOST_FX_CLASSES.glow/glowOuter/ring` element
- [ ] 3.2 Selection moves between cards (test-plan #E2) in `AutomationBoard.test.tsx` (see its E20 card-click test): a selected · click `automation-def-b` · exactly one `aria-current` (b); a back to `border-[var(--border-secondary)]`, no soft fill, name `font-semibold` only
- [ ] 3.3 Fresh board has no selection marker (test-plan #E3) in `AutomationBoard.test.tsx` (see its "renders definition cards" test): 3 automations, freshly mounted · render · 0 `aria-current`, 0 `bg-[var(--accent-soft)]`, 0 FX layer elements
- [ ] 3.4 Selected card body keeps its surface (test-plan #E4) in `AutomationBoard.test.tsx` (see its E19 run-result link test): a with a done run, selected · click `automation-def-a` · root keeps `bg-[var(--bg-secondary)]`, exactly one soft-fill descendant, and the run-result link is outside it
- [ ] 3.5 Visuals module drops the neon constants (test-plan #E5) in `packages/automation-plugin/src/__tests__/automation-card-visuals.test.ts` (see its F6 reduced-motion test): module namespace import · read keys · `GLOW_FX_CLASS`, `GLOW_FX_OUTER_CLASS`, `RING_FX_CLASS` undefined; `stripeFxClass("running")` unchanged
- [ ] 3.6 Header-row pairs AA in every palette (test-plan #E6) in `packages/client/src/lib/__tests__/themes.test.ts` (see its "accent ramp" describe and `contrast` helper): every `themes.ts` palette with its scope's `--accent-soft` · compute `--text-primary` and `--text-secondary` on it · every ratio at least 4.5
- [ ] 3.7 Theme-token guard stays clean (test-plan #E7), a check run with `node scripts/theme-token-guard.mjs` (not wired into a workflow; same row as polish-automation-board test-plan E23): plugin client sources · run guard · no new violation for `packages/automation-plugin/src/client`
- [ ] 3.8 Selected running card keeps its stripe (test-plan #F1) in `AutomationBoard.test.tsx` (see its F7 stripe test): a with a running run · click `automation-def-a` · `automation-rail-stripe-a` and `automation-pill-stripe-a` present, `aria-current="true"`, no FX layer
- [ ] 3.9 Card actions do not move selection (test-plan #F2) in `AutomationBoard.test.tsx` (see its E20 name-opens-editor test): a selected · click `automation-name-b` · a keeps `aria-current="true"`, b has none
- [ ] 3.10 Visual check of the board against the adopted mockup in Base dark, Base light and one non-base palette at 375 and 1440 px (test-plan: manual-only, #F3)

## 4. Docs

- [ ] 4.1 Update the `AutomationBoard.tsx` and `automation-card-visuals.ts` rows in `packages/automation-plugin/src/client/AGENTS.md` (selection = selected-chip recipe, FX constants gone; See change: use-selector-style-for-automation-selection)
- [ ] 4.2 In `ui-contract.md` (Card pill roles, next to "Pressed chips"), add the selectable-card variant: `--accent` border + `--accent-soft` header row only, body keeps its surface; See change: use-selector-style-for-automation-selection
