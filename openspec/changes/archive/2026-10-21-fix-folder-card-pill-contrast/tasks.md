# Tasks

## 1. Folder action banner (design D1, D2, D4)

- [x] 1.1 Add i18n keys `folders.bannerRetrust`, `folders.bannerRetrustAction`, `folders.bannerInitNeeded`, `folders.bannerInitAction` with the en / hu / zh-CN strings from design D1 to `packages/client/src/lib/i18n-en-source.json`, `packages/client/src/lib/i18n/i18n-hu.ts`, `packages/client/src/lib/i18n/i18n-zh-CN.ts`; verify: `packages/client/src/__tests__/i18n.test.ts` and `packages/client/src/lib/__tests__/i18n-orphans.test.ts` pass.
- [x] 1.2 `packages/client/src/components/folder/FolderActionBanner.tsx`: render glyph + message for the `retrust` (`mdiShieldAlertOutline`) and `init-needed` (`mdiScriptTextPlayOutline`) rungs before the hosted `WorktreeInitButton`; compact chip (`:133`) and setup action (`:165`) to 12 px; compact chip glyph matches its rung; verify: `FolderActionBanner` unit tests updated and passing.
- [x] 1.3 `packages/client/src/components/worktree/WorktreeInitButton.tsx`: colour-free outlined action (`border border-current`, `currentColor` hover fill, `focus-ring`, 12 px semibold, `min-h-[44px] md:min-h-[32px]`); labels from `folders.bannerRetrustAction` / `folders.bannerInitAction`; no inner glyph (drop `mdiScriptTextPlayOutline`, `:154`); testid `worktree-init-btn` unchanged; update the label assertion in `WorktreeInitButton.test.tsx`; verify: test passes.
- [x] 1.4 `packages/client/src/components/worktree/WorktreeInitChip.tsx`: running / done / failed content inherits `currentColor` (spinner arc, progress bar, elapsed, last line, failure code on a second line at 11 px mono); `LogDisclosure` toggle (`:55`) inherits at 11 px while its expanded `<pre>` body (`:59`) is `--text-secondary` on `--bg-code` at 11 px; `✓ ✕ ↻` → `mdiCheckCircleOutline` / `mdiAlertCircleOutline` / `mdiReplay`; Retry `border-current` 12 px; no palette class, no `--text-muted` / `--text-tertiary`; testids unchanged; verify: existing chip / button tests pass.

- [x] 1.5 Add `nonTextFailures(scope, floor)` to `tests/e2e/helpers/computed-contrast.ts` (svg `color` and `.animate-spin` `border-top-color` vs composited backdrop), copying the compositing glue of `measureText` in the same file; verify: unit-exercised by 1.12–1.16 (test-plan: automated, new infra).
- [x] 1.6 L1 test, exemplar `packages/client/src/components/folder/__tests__/FolderActionBanner.test.tsx`: status `{hasHook:true, trusted:false}` · render · `folder-banner-retrust-<cwd>` holds "Init hook needs your trust before it can run" outside `worktree-init-btn`, button text exactly "Review & trust" with no inner svg, one `mdiShieldAlertOutline` glyph, no "changed" in the text (test-plan #E14).
- [x] 1.7 L1 test, exemplar `packages/client/src/components/folder/__tests__/FolderActionBanner.test.tsx`: status `{hasHook:true, trusted:true, needsInit:true}` · render · `folder-banner-init-needed-<cwd>` holds "Init hook hasn't run in this checkout" and a glyph-less "Initialize" `worktree-init-btn` (test-plan #E15).
- [x] 1.8 L1 test, exemplar `packages/client/src/__tests__/i18n.test.ts`: UI language `hu`, untrusted status · render retrust banner · message and label equal the `hu` values of `folders.bannerRetrust` / `folders.bannerRetrustAction`, not the English strings (test-plan #E16).
- [x] 1.9 L1 test, exemplar `packages/client/src/components/__tests__/WorktreeInitButton.test.tsx`: `WorktreeInitChip` running (`lastLine`), done, failed (`script_nonzero_exit`, `stderr`) · render each · no palette class and no `--text-muted`/`--text-tertiary`; spinner/bar `currentColor`; done glyph `mdiCheckCircleOutline`; "Init failed" and the code in separate block elements; `worktree-init-retry` has `border-current`, `text-[12px]`, `mdiReplay`; opened log `<pre>` carries `--text-secondary` + `--bg-code` (test-plan #E17).
- [x] 1.10 L1 test, exemplar `packages/client/src/components/folder/__tests__/FolderActionBanner.test.tsx`: card glyph set (folder, cog, branch, folder-menu items incl. `mdiRefresh`, setup `mdiTextBoxCheckOutline`) · compare with banner glyphs retrust/init/done/failed/retry · intersection empty (test-plan #E18).
- [x] 1.11 L1 test, exemplar `packages/client/src/components/folder/__tests__/FolderActionBanner.test.tsx`: `status = null` · render · no banner region and no `worktree-init-btn` (test-plan #X2).
- [x] 1.12 L3 test, exemplar `tests/e2e/worktree-init-feedback.spec.ts` (fixture) + `tests/e2e/severity-contrast.spec.ts` (palette switch): untrusted `/fixtures/sample-hook-ok`, base light · locate `folder-banner-retrust-<cwd>` · `contrastFailures(measureText(region), 4.5)` and `nonTextFailures(region, 3)` empty; message visible (test-plan #F1).
- [x] 1.13 L3 test, exemplar `tests/e2e/severity-contrast.spec.ts`: same retrust banner · switch base dark / base light / nord dark / nord light · computed `color` of `worktree-init-btn` equals the region's in each (test-plan #F2).
- [x] 1.14 L3 test, exemplar `tests/e2e/worktree-init-feedback.spec.ts`: `/fixtures/sample-hook-ok`, base light · trust + run, wait for `worktree-init-chip` · while running text ≥ 4.5:1 and spinner arc ≥ 3:1, preview line in the region colour; converges to "Initialized" on the info rung, then the banner detaches (test-plan #F3).
- [x] 1.15 L3 test, exemplar `tests/e2e/worktree-init-feedback.spec.ts`: `/fixtures/sample-hook-fail`, base light · trust + run, open `View log` · error rung, text ≥ 4.5:1, log `<pre>` colour = resolved `--text-secondary` on `--bg-code`, toggle colour = region colour, `worktree-init-retry` on its own row (test-plan #F4).
- [x] 1.16 L3 test, exemplar `tests/e2e/folder-action-banner.spec.ts`: retrust banner · render at 375×812 and 1280×800, Tab to `worktree-init-btn` · height ≥ 44 px / ≥ 32 px; visible focus ring (non-zero outline or box-shadow) (test-plan #F7).

## 2. Slot pills + folder sections (design D3, D4)

- [x] 2.1 `packages/dashboard-plugin-runtime/src/SlotPill.tsx`: `ACCENT` resolves blue/indigo→blue, cyan/teal→green, purple→purple, red→red onto literal `text-[var(--accent-<h>-text)] bg-[var(--tint-<h>-bg)] hover:border-[var(--tint-<h>-border)]`; update `SlotPill.test.tsx` hover-border token; verify: test passes.
- [x] 2.2 `packages/automation-plugin/src/client/FolderAutomationSection.tsx` (`:101` unit 11 px, `:103` marker `--accent-orange-text` 11 px) and `packages/goal-plugin/src/client/FolderGoalsSection.tsx` (`:65` unit 11 px); verify: plugin section tests pass.
- [x] 2.3 `packages/mcp-client-plugin/src/client/FolderMcpSection.tsx`: off-count (`:163`) → `--accent-orange-text`, parse-error marker (`:52`) → `--accent-red-text`, `:133` fallback literal removed; verify: MCP section tests pass.
- [x] 2.4 `packages/client/src/components/openspec/FolderOpenSpecSection.tsx`: broken-state glyph (`:234`) → purple token pair; units (`:347`, `:371`) 11 px; verify: OpenSpec section tests pass.

- [x] 2.5 L1 test, exemplar `packages/dashboard-plugin-runtime/src/__tests__/SlotPill.test.tsx`: one `SlotPill` per accent `blue`,`indigo`,`cyan`,`teal`,`purple`,`red` · render · glyph classes resolve blue+indigo→blue, cyan+teal→green, purple, red token pairs, hover `--tint-<h>-border`, no `-400`/`-500` class (test-plan #E1).
- [x] 2.6 L1 test (new `packages/client/src/lib/__tests__/card-pill-token-contrast.test.ts`), exemplar `packages/client/src/lib/__tests__/action-menu-tone-contrast.test.ts`: 18 palettes · resolve `--accent-<h>-text` vs `--tint-<h>-bg` for blue/green/purple/red · every ratio ≥ 3.0, failure names palette + hue + ratio (test-plan #E2).
- [x] 2.7 L1 test in the same file, exemplar `packages/client/src/lib/__tests__/action-menu-tone-contrast.test.ts`: 18 palettes · resolve the six `--accent-<h>-text` vs `--bg-secondary`, and `--text-secondary` vs `--bg-secondary` in base dark/light · every cell ≥ 4.5 (test-plan #E3).
- [x] 2.8 L1 tests, exemplars `packages/automation-plugin/src/__tests__/FolderAutomationSection.test.tsx`, `packages/mcp-client-plugin/src/client/__tests__/FolderMcpSection.test.tsx`, `packages/goal-plugin/src/__tests__/FolderGoalsSection.test.tsx`, `packages/client/src/components/__tests__/FolderOpenSpecSection.test.tsx`: 2 invalid automations; MCP `count:2, off:1` + parse error; goals; OpenSpec broken + normal · render · markers `--accent-orange-text` / `--accent-red-text`, unit + marker `text-[11px]`, OpenSpec broken glyph purple token pair, no `#27272a` (test-plan #E21).
- [x] 2.9 L3 test, exemplar `tests/e2e/fix-slot-pill-legend-overflow.spec.ts`: pinned `kb-sample` folder, base light · locate the slot pill grid · every glyph svg ≥ 3:1 via `nonTextFailures`, every text node ≥ 4.5:1 and ≥ 11 px (test-plan #F5).

## 3. Related pills (theme-system "Card pill colour roles")

- [x] 3.1 `packages/client/src/components/openspec/OpenSpecActivityBadge.tsx`: phase map folded onto `--accent-<hue>-text` (design / spec mapping); task count (`:68`) → `--text-secondary`; verify: badge tests pass.
- [x] 3.2 `packages/client/src/components/openspec/openspec-helpers.tsx`: `statusColor` → `--accent-green-text` / `--accent-yellow-text` / `--text-secondary`; `ArtifactLetters` and `ArtifactLettersButton` letters 12 px; `ArtifactLettersButton` hover border (`:63`) → `--accent`; update `ArtifactLettersButton.test.tsx` class asserts; verify: tests pass.
- [x] 3.3 `packages/client/src/components/openspec/OpenSpecGroupPills.tsx`: pressed = `--text-primary` on `--accent-soft`, `--accent` border; unpressed `--text-secondary`; labels 12 px; manage link `--text-secondary` 12 px, hover `--link-hover`; verify: group-pill tests pass.
- [x] 3.4 `packages/flows-plugin/src/client/FlowActivityBadge.tsx`: statuses → `--accent-<hue>-text`; Abort → `--tint-red-*` triple, 12 px; verify: flows-plugin tests pass.
- [x] 3.5 `packages/client/src/components/session/SessionList.tsx`, four sites only:
  - `ToggleButton` (`:373-392`) and include-archive chip (`:2893-2898`): pressed = selected-chip recipe, unpressed `--text-secondary`, 12 px
  - add-to-workspace node (`:1658`): neutral — `--text-primary` label, `--border-secondary` outline, no hue
  - pinned indicator (`:2190`): `--accent-yellow-text`

  Verify: SessionList tests pass.
- [x] 3.6 `packages/client/src/components/worktree/WorktreeInitStack.tsx`:
  - running spinner → `--accent-blue-text`
  - done / failed glyph + text → `--accent-green-text` / `--accent-red-text`, using MDI icons instead of `✓ ✕`
  - failed row → `--severity-error-{bg,fg}`
  - Dismiss → neutral (`--text-primary` label, `--border-secondary` outline), 12 px
  - meta → `--text-secondary`; mono 11 px
  - shadow → `shadow-[0_8px_24px_var(--shadow-card)]`

  Verify: stack tests pass.

- [x] 3.7 L1 test (new `packages/client/src/components/__tests__/OpenSpecActivityBadge.test.tsx`), exemplar `packages/client/src/components/__tests__/ArtifactLettersButton.test.tsx`: each of 9 phases, `completedTasks=4,totalTasks=12` · render · explore/continue/ff → blue, new/sync-specs/onboard → purple, apply → yellow, verify/archive → green `--accent-<h>-text`; `(4/12)` `--text-secondary`; no `--text-muted` (test-plan #E4).
- [x] 3.8 L1 test, exemplar `packages/client/src/components/__tests__/ArtifactLettersButton.test.tsx`: artifacts `[done, ready, blocked, missing]` · render · letters `--accent-green-text`, `--accent-yellow-text`, `--text-secondary`, `--text-secondary`, `text-[12px]`, hover border `--accent`, no palette class (test-plan #E5).
- [x] 3.9 L1 test (new `packages/flows-plugin/src/client/__tests__/FlowActivityBadge.test.tsx`), exemplar `packages/client/src/components/__tests__/ArtifactLettersButton.test.tsx`: status running (+`onAbort`), success, error, aborted · render · root `--accent-blue/green/red/orange-text`; Abort `--tint-red-{fg,bg,border}` + `text-[12px]` (test-plan #E6).
- [x] 3.10 L1 test (new `packages/client/src/components/__tests__/OpenSpecGroupPills.test.tsx` + `SessionList` `ToggleButton` case), exemplar `packages/client/src/components/__tests__/ArtifactLettersButton.test.tsx`: no active group / one active group; toggle on / off · render · active `text-[var(--text-primary)] bg-[var(--accent-soft)] border-[var(--accent)]`, inactive `--text-secondary`, `text-[12px]`, manage link `--text-secondary` + hover `--link-hover` (test-plan #E19).
- [x] 3.11 L1 test, exemplar `packages/client/src/components/__tests__/WorktreeInitStack.test.tsx`: 3 runs (running, done, failed `script_nonzero_exit`) · render · failed row `--severity-error-bg/fg`; done `--accent-green-text` + `mdiCheckCircleOutline`, no `✓`/`✕` text; Dismiss neutral `text-[12px]`; meta `--text-secondary`; shadow `var(--shadow-card)` (test-plan #E20).
- [x] 3.12 L3 test, exemplar `tests/e2e/severity-contrast.spec.ts` (contrast) + `tests/e2e/folder-actions-menu.spec.ts` (pinning): base light, a pinned folder, archive browser on a change with artifacts · toggle include-archive chip and one sidebar `ToggleButton` on then off · chips text ≥ 4.5:1 with pressed ratio ≥ unpressed; `folder-pinned-indicator-<cwd>` svg ≥ 3:1; artifact letters ≥ 4.5:1 and ≥ 12 px (test-plan #F6).

## 4. Guard + contract (design D5)

- [x] 4.1 `scripts/theme-token-guard.mjs`: add the `rawPalette` arm and extend `scripts/__tests__/theme-token-guard.test.mjs`; verify: guard tests pass. The arm covers:
  - the D5 pattern, including `border-<side>` and `ring-offset`
  - `<file>::<hue>` counts
  - one `ARMS` list driving `loadBaseline`, `grownEntries`, `bootstrapArm` and `writeBaseline`, plus a round-trip test (bootstrap → `--write` → `rawPalette` key survives)
  - `--bootstrap-arm rawPalette`
  - `loadBaseline` requiring the key once bootstrapped
  - a failure message naming the arm, file, hue and replacement token families
- [x] 4.2 After groups 1–3, bootstrap the baseline: `node scripts/theme-token-guard.mjs --write --bootstrap-arm rawPalette`; verify: the guard passes on the tree, and the baseline has no entry for any card-pill file except `SessionList.tsx`. The bootstrap runs once: if a card-pill file shows up in the baseline, fix its source and run `node scripts/theme-token-guard.mjs --write` to shrink the entry away.
- [x] 4.3 `ui-contract.md`: record the card-pill token roles (banner inherit, SlotAccent → host hue, selected-chip recipe for pressed chips, phase / flow / letter folding) and the `rawPalette` arm; update `scripts/theme-token-guard.mjs.AGENTS.md` and the touched directories' `AGENTS.md` rows; verify: `node scripts/check-conventions.mjs` passes.

- [x] 4.4 L1 test (new `packages/client/src/lib/__tests__/card-pill-surfaces-no-literals.test.ts`), exemplar `packages/client/src/lib/__tests__/aligned-surfaces-no-literals.test.ts`: AST literals of the 13 listed files + the 4 `SessionList.tsx` regions · scan with rawPalette pattern, `#hex`, `rgba(`, fallback literal · zero matches, `--text-muted` only on `disabled:`/`aria-hidden`; a planted `text-amber-400` in a fixture copy fails naming the file (test-plan #E7).
- [x] 4.5 L1 test, exemplar `scripts/__tests__/theme-token-guard.test.mjs`: fixture baseline lacking `::amber` · add `text-amber-400` to `Foo.tsx`, run `main()` · exit 1 naming `rawPalette`, `Foo.tsx`, `amber` and the replacement families (test-plan #E8).
- [x] 4.6 L1 test, exemplar `scripts/__tests__/theme-token-guard.test.mjs`: fixture with `border-l-blue-400`, `hover:ring-offset-red-500/40`, `md:text-emerald-300` · scan · sites `::blue`, `::red`, `::emerald` recorded (test-plan #E9).
- [x] 4.7 L1 test, exemplar `scripts/__tests__/theme-token-guard.test.mjs`: baseline `Foo.tsx::blue = 2` · files with 3 / 2 / 1 occurrences · 3 fails, 2 passes, 1 passes as shrinkable; after `--write` re-adding fails (test-plan #E10).
- [x] 4.8 L1 test, exemplar `scripts/__tests__/theme-token-guard.test.mjs`: token paints `text-[var(--accent-red-text)]`, `bg-[var(--tint-blue-bg)]`, `text-white`, `text-xs`, `border-2` + `Foo.test.tsx` with `text-green-500` · scan · zero `rawPalette` sites (test-plan #E11).
- [x] 4.9 L1 test, exemplar `scripts/__tests__/theme-token-guard.test.mjs`: three-arm fixture baseline · `--write --bootstrap-arm rawPalette`, shrink one site, `--write` · `rawPalette` key survives with shrunk count; second bootstrap exits 1; growing `--write` exits 1 (test-plan #E12).
- [x] 4.10 L1 test, exemplar `scripts/__tests__/theme-token-guard.test.mjs`: real tree + committed baseline · run `main()` on real roots · exit 0 and no `rawPalette` key for the 13 listed card-pill files (test-plan #E13).
- [x] 4.11 L1 test, exemplar `scripts/__tests__/theme-token-guard.test.mjs`: baseline with `rawPalette` deleted after bootstrap · run `main()` · exit 1 naming the missing map and the bootstrap command, never an implicit empty map (test-plan #X1).

## 5. Verification

- [x] 5.1 Full suite + build: `npm test` and `npm run build` green; `npm run quality:changed` clean; `node scripts/theme-token-guard.mjs` passes.
- [x] 5.2 Manual visual check of the built app in base dark, base light, nord dark and nord light against `mockups/folder-card-pill-contrast/index.html`: dark palettes read nearly unchanged, slot hues acceptable, banner rungs match the board (test-plan: manual-only, #F8).
