## Scope note

This change is **phased**. It lands the layering **foundation** + the **concrete underlap fix** +
**discoverability**, and token-swaps only the overlays that already portal (Tier A). The portal-rewrite
of the ~12 inline-`absolute` popovers (Tier B) and `FilePreviewOverlay` is **split into a follow-up
change** (`portal-inline-popovers`) and captured in the lint baseline — see `design.md`. Automated test
tasks below are folded from `test-plan.md` (ids `test-plan #E*/F*`).

## 1. Survey & decisions (done inline in design.md)

- [x] 1.1 Overlay inventory + Tier A (already portaled → token swap) vs Tier B (inline absolute → follow-up).
- [x] 1.2 Design decision D-1: single shared layer root (`document.body`) + a non-scroll-locking `LayerPortal`.
- [x] 1.3 Root cause confirmed: `SessionCard` `relative isolate` creates a stacking context per card, so
      an inline-absolute folder popover is trapped and underlaps. Portal is the only fix.

## 2. Token scale — tests first

- [ ] 2.1 (test-plan #E1) Author the layer-scale ascending/unique test in
      `packages/client/src/__tests__/z-layers.test.ts`. Exemplar: any sibling `packages/client/src/__tests__/*.test.ts`.
      Triple: input = the 8 `--z-*` declarations in `index.css` · trigger = parse file · observable = all 8
      declared, strictly ascending `base<raised<sidebar<overlay<popover<dialog<toast<lightbox`, all distinct.
- [ ] 2.2 (test-plan #E2) Add the utility-mapping test in the same file. Triple: input = `@utility z-<name>`
      blocks · trigger = parse · observable = each of the 8 utilities exists and is bound to `var(--z-<name>)`.
- [ ] 2.3 (test-plan #E3) Add the ordering-guarantee test. Triple: input = resolved token ints · trigger =
      compare · observable = `dialog>popover` AND `toast>dialog` AND `lightbox>toast` (modal outranks menu by token).
- [ ] 2.4 Run `npm test 2>&1 | tee /tmp/pi-test.log`; confirm only the new token tests fail (RED).

## 3. Token scale — implementation

- [ ] 3.1 Declare `--z-base … --z-lightbox` in `:root` of `packages/client/src/index.css` (theme-independent).
- [ ] 3.2 Add matching Tailwind `@utility z-base … z-lightbox` referencing the tokens.
- [ ] 3.3 Confirm 2.1–2.3 pass (GREEN).

## 4. Non-locking LayerPortal + concrete FolderActionsMenu fix

- [ ] 4.1 Add `LayerPortal` in client-utils (portals to `document.body`, NO body-scroll lock, unlike
      `DialogPortal`) + export it in `packages/client-utils/package.json`.
- [ ] 4.2 Extend `usePopoverFlip` additively to also return the trigger's viewport `triggerRect`
      (existing consumers ignore it; no behaviour change). Re-measure on capture-phase scroll already
      exists — that is what makes the portaled `fixed` panel track ancestor (sidebar) scroll.
- [ ] 4.3 (test-plan #F1) Author the desktop-portal test in
      `packages/client/src/components/__tests__/FolderActionsMenu.test.tsx`. Exemplar: same file's existing
      cases. Triple: input = desktop `FolderActionsMenu` (`useMobile→false`), open · trigger = click ·
      observable = panel NOT contained by the trigger's wrapper `<span>`; `className` has `z-popover`+`fixed`,
      not `absolute`/`z-50`.
- [ ] 4.4 (test-plan #F2) Author the both-forms-portal test in the same file. Triple: input =
      `useMobile→true` then `false`, open · trigger = click · observable = in BOTH forms the panel renders
      outside the trigger subtree (mobile `DialogPortal`, desktop `LayerPortal`).
- [ ] 4.5 Convert the desktop path of `packages/client/src/components/folder/FolderActionsMenu.tsx` to a
      `LayerPortal` + `fixed` panel positioned from `triggerRect`/`flipUp`/`anchorRight` (token `z-popover`;
      mobile sheet `z-dialog`). Update the doc comment with `See change: add-overlay-layering-system`.
- [ ] 4.6 Confirm 4.3–4.4 pass and existing FolderActionsMenu tests (dismiss/escape/roving) stay green.

## 5. Token-swap the already-portaled overlays (Tier A — mechanical)

- [ ] 5.1 `lightbox`: `preview/ImageLightbox.tsx` (`z-[9999]`).
- [ ] 5.2 `toast`: `extension-ui/ToastSlot.tsx` (`z-[100]`), `primitives/Toast.tsx` (`z-50`),
      `settings/DiagnosticsSection.tsx` (`z-[80]`), `session/SpawnErrorToastHost.tsx` (`z-50`).
- [ ] 5.3 `dialog`: `openspec/OpenSpecBoardView.tsx` (`z-[60]`), `resource/ResourceTrustDialog.tsx`,
      `settings/FirstLaunchDisplayModal.tsx`, `extension-ui/GenericExtensionDialog.tsx`,
      `settings/SettingsPanel.tsx` (modal layer only). NOTE: `preview/FilePreviewOverlay.tsx` is DEFERRED
      — its `z-[70]` intentionally sits above dialog `z-[60]`; allowlist it, decide its layer in the follow-up.
- [ ] 5.4 `popover`: the already-portaled `session/TasksPopover.tsx` (`z-50`), `shell/MobileActionMenu.tsx`.
- [ ] 5.5 `overlay`/`sidebar`: `shell/MobileOverlay.tsx`, `worktree/WorktreeInitStack.tsx` (`z-40`),
      `session/RecoveryOfferHost.tsx`, `hooks/usePluginToggle.tsx`.
- [ ] 5.6 Leave every inline-`absolute` Tier-B popover, `FilePreviewOverlay`, and in-flow decoration
      (`SessionCard` `z-20`, sticky headers, scrollbar shims) UNTOUCHED. Record each skipped occurrence.

## 6. Lint guard — frozen baseline ratchet

- [ ] 6.1 Add `scripts/z-layer-lint.mjs` as a FROZEN BASELINE RATCHET (model on `scripts/knip-ratchet.mjs`):
      capture current raw-`z-[NNNN]` / ad-hoc numeric-z occurrences in `packages/client/src` as the baseline
      (Tier-B + FilePreviewOverlay + in-flow set) and FAIL on a NEW occurrence outside the `z-*` token
      utilities. Baseline may only shrink. Wire it into the quality scripts.
- [ ] 6.2 (test-plan #E4) Author the ratchet add-rejected test. Exemplar: `scripts/knip-ratchet.mjs` +
      any `scripts/*.test.*` if present, else a fixture-driven unit. Triple: input = baseline + fixture with
      ONE new `z-[123]` outside token utilities · trigger = run the lint · observable = exit ≠ 0, message names it.
- [ ] 6.3 (test-plan #E5) Author the ratchet shrink-allowed test. Triple: input = baseline with one
      allowlisted raw-z removed · trigger = run the lint · observable = exit 0, baseline count decreased.
- [ ] 6.4 Run it over `packages/client/src`; confirm zero violations after the Tier-A migration.

## 7. Docs & discoverability

- [ ] 7.1 (DocScribe) Add the layer-scale reference table + portal-or-perish rule to `docs/architecture.md`
      (caveman style).
- [ ] 7.2 Add the layering keywords (z-index, stacking context, underlap, portal, layer token) to the
      relevant `packages/client/src/components/**/AGENTS.md` + `client-utils` rows so `kb_search` routes here.
- [ ] 7.3 `openspec validate add-overlay-layering-system --strict` passes.

## 8. E2E (docker harness) + verification

- [ ] 8.1 (test-plan #F3) Author the underlap E2E in `tests/e2e/overlay-layering.spec.ts`. Exemplar:
      `tests/e2e/popover-container-clip.spec.ts` (bbox asserts) + `tests/e2e/folder-membership-drag.spec.ts`
      (reaching a folder header). Triple: input = ≥2 `relative isolate` session cards under a folder header ·
      trigger = open the folder-actions menu overlapping a card below · observable =
      `document.elementFromPoint(x,y)` at a point inside both the menu bbox and a card bbox returns a node
      contained by `folder-actions-menu-panel-*` (menu topmost).
- [ ] 8.2 (test-plan #F4) Author the scroll-tracking E2E in the same spec. Triple: input = open menu whose
      trigger sits in the scrollable sidebar list · trigger = scroll the list by ΔY=120px · observable =
      after scroll `|(panel.top − trigger.bottom) − 4| ≤ 3px` (panel stays anchored).
- [ ] 8.3 `npm test 2>&1 | tee /tmp/pi-test.log`; grep for FAIL — unit suite green.
- [ ] 8.4 `npm run build` succeeds (Tailwind picks up the new `@utility` layers).
- [ ] 8.5 Run the E2E spec against the docker harness (per `run-dashboard-e2e-local-changes`); confirm green.
- [ ] 8.6 (test-plan #F5, manual-only) Manual smoke: folder-actions menu + a dialog/toast/lightbox paint
      above siblings at 375 / 768 / 1440. (test-plan: manual-only)
