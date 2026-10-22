# Tasks

Plan-proposal is driving this change. Test tasks map 1:1 to `test-plan.md` rows (`(test-plan #<id>)`). Run `#E3`/`#E4`/`#E5` early (group 4 spike first): the width budget in design D2 is an estimate.

## 1. Header icon-button recipe

- [ ] 1.1 Add `packages/client/src/components/primitives/header-icon-button.ts` exporting `HEADER_ICON_BTN` (design D1 class string) and `HEADER_ICON_SIZE = 0.75`, and add its row to `packages/client/src/components/primitives/AGENTS.md`; verify `npx tsc --noEmit -p packages/client` passes
- [ ] 1.2 In `SessionList.tsx` apply the recipe to the Discord `<a>`, the Settings button and the filter funnel, and change the left group to `gap-1`; verify the funnel badge still renders (`SessionList.header-declutter.test.tsx` green)
- [ ] 1.3 In `FocusToggle.tsx` replace `rounded px-0.5` + `text-blue-400 bg-blue-500/15` with `HEADER_ICON_BTN` + `HEADER_ICON_SIZE`, and update `FocusToggle.test.tsx:28`; verify `npx vitest run packages/client/src/components/session/__tests__/FocusToggle.test.tsx` passes
- [ ] 1.4 In `ThemePicker.tsx` switch the trigger to `HEADER_ICON_BTN` with `mdiBrightness6` at `HEADER_ICON_SIZE`; verify `ThemePicker.test.tsx` passes with the trigger testid unchanged
- [ ] 1.5 Test: extend `packages/client/src/components/__tests__/SessionList.header-declutter.test.tsx` (exemplar: same file). Input: header rendered with all features. Trigger: render `SessionList`. Observable: `discord-btn`, `theme-picker-trigger`, `focus-toggle-btn`, `settings-btn` and `filter-funnel-btn` each have `size-7` + `rounded-md`, an `svg` with inline `width: 1.125rem`, and no Tailwind palette colour class (test-plan #E1)
- [ ] 1.6 Test: extend `packages/client/src/components/session/__tests__/FocusToggle.test.tsx` (exemplar: same file). Input: Focus off. Trigger: click `focus-toggle-btn`. Observable: `aria-pressed="true"`, classes contain `aria-pressed:bg-[var(--accent-soft)]`, and no `text-blue-400` / `bg-blue-500/15` (test-plan #F4)
- [ ] 1.7 Test: add a header-icon contrast case to `tests/e2e/sidebar-header-fit.spec.ts` (exemplar: `tests/e2e/action-menu-tones.spec.ts` + `tests/e2e/helpers/computed-contrast.ts`). Input: themes `{base,dark}`, `{base,light}`, `{nord,dark}`. Trigger: compute each of the 5 buttons' glyph colour against its row background. Observable: every ratio ≥ 3.0 and each box is 28 × 28 px (test-plan #E2)
- [ ] 1.8 Test: add a hover/open-fill case to `tests/e2e/sidebar-header-fit.spec.ts` (exemplar: same file). Input: `{base,dark}`. Trigger: hover `settings-btn`, then click `theme-picker-trigger`. Observable: computed background equals resolved `--bg-hover` in both, and the trigger has `aria-expanded="true"` (test-plan #F7)

## 2. Connection chip

- [ ] 2.1 Add `currentServerKind(currentEntry, currentHost)` beside `buildServerEntries` in `ServerSelector.tsx`, stripping IPv6 brackets before `isLoopbackOrigin`; leave the `currentEntry` lookup (`:254`, `:403`) unchanged (design D5); verify with 2.7
- [ ] 2.2 Render the chip glyph per design D5:
  - `connection-chip-glyph` with `data-kind` / `data-offline`;
  - `mdiLaptop` / `mdiServerNetwork` / `…Off` at `size-4.5`;
  - an `aria-hidden` top-right `size-2` dot badge with `ring-2 ring-[var(--bg-secondary)]`;
  - `connection-chip-offline-glyph` on the glyph wrapper while offline;
  - remove the `mdiCloudOffOutline` element.

  Verify with 2.8.
- [ ] 2.3 Chip layout per design D2/D5:
  - offline glyph and "Offline" word in `--accent-red-text`;
  - word shown only `@min-[480px]`;
  - name `max-w-24 @min-[480px]:max-w-40`;
  - below 400 px: name and chevron hidden, plus `min-w-8 px-1.5 justify-center`.

  Verify with 2.12 (#E5).
- [ ] 2.4 Set the chip `title` to the new `connection.switchServerNamed` key ("{server}: switch server"), added to `i18n-en-source.json`, `i18n-zh-CN.ts` and `i18n-hu.ts`; verify with 2.6
- [ ] 2.5 Update `ServerSelector.tsx.AGENTS.md` and the `components/connectivity/AGENTS.md` row (`See change: polish-sidebar-header-controls`); verify the rows name `currentServerKind` and `connection-chip-glyph`
- [ ] 2.6 Test: extend `packages/client/src/components/__tests__/ServerSelector.chip.test.tsx` (exemplar: same file). Input: current-server label `pi-dashboard-31f4d8185a43-studio`. Trigger: render the chip. Observable: name span classes include `max-w-24` and `@min-[480px]:max-w-40`; `title` = "pi-dashboard-31f4d8185a43-studio: switch server"; `aria-label` contains the full name (test-plan #E8)
- [ ] 2.7 Test: add a `currentServerKind` decision-table case to `ServerSelector.chip.test.tsx` (exemplar: the `buildServerEntries` cases in the same directory). Input: (a) entry `isLocal:true`, (b) entry `isLocal:false`, (c) no entry + `127.0.0.1`, (d) no entry + `[::1]`, (e) no entry + `192.168.1.5`, (f) no entry + `localhost`. Trigger: call the helper. Observable: local, remote, local, local, remote, local (test-plan #E9)
- [ ] 2.8 Test: extend `ServerSelector.chip.test.tsx` (exemplar: same file, E6). Input: {local, remote} × {connected, offline}. Trigger: render the chip. Observable: `data-kind` / `data-offline` match; the `path` `d` equals `mdiLaptop` / `mdiServerNetwork` / `mdiLaptopOff` / `mdiServerNetworkOff`; `connection-chip-offline-glyph` present only when offline; dot `aria-hidden="true"` (test-plan #E10)
- [ ] 2.9 Test: extend `ServerSelector.chip.test.tsx` (exemplar: same file). Input: origin and current host `127.0.0.1:8000`, no known servers. Trigger: render `ServerSelector`. Observable: visible name `127.0.0.1`, `data-kind="local"` (test-plan #E11)
- [ ] 2.10 Test: rewrite X2 in `ServerSelector.chip.test.tsx` (exemplar: same file). Input: `connected=false`, remote current server. Trigger: render the chip. Observable: `aria-label` contains "offline"; `connection-chip-offline-glyph` present; no `mdiCloudOffOutline` path; no "Connected" text (test-plan #X1)
- [ ] 2.11 Test: add an unresolved-entry case to `ServerSelector.chip.test.tsx` (exemplar: same file). Input: `currentHost` `10.0.0.9`, absent from entries, entries holding only the seeded Local. Trigger: render the chip. Observable: no throw, `data-kind="remote"`, visible name `10.0.0.9` (test-plan #X2)
- [ ] 2.12 Test: rewrite #E5 in `tests/e2e/sidebar-header-fit.spec.ts` (exemplar: same file, current #E5). Input: offline, server "Local". Trigger: sidebar 410 / 411 / 490 / 491 px. Observable:
  - `connection-chip-offline-glyph` visible at all four widths;
  - "Offline" visible only at 491;
  - name + chevron hidden at 410, visible at 411 / 490 / 491;
  - the chip is ≥ 32 × 32 px at 410.

  (test-plan #E5)
- [ ] 2.13 Test: extend `tests/e2e/yolo-indicator-layout.spec.ts` (exemplar: its "tint keeps row 1 legible" case). Input: one YOLO session, offline, `{base,dark}`, `{base,light}`, `{nord,dark}`. Trigger: run the legibility probe on `header-app-bar`. Observable: the failure list is empty, including `connection-chip-glyph` (test-plan #F6)

## 3. Appearance dropdown

- [ ] 3.1 Rebuild `ThemeToggle.tsx` as the design D4 segmented control:
  - icon + visible label, `min-h-9 max-sm:min-h-11 text-xs font-semibold`;
  - pressed = selected-chip recipe;
  - labels and titles from the new `common.themeLight|System|Dark` keys (all three catalogs);
  - testids and `aria-pressed` kept.

  Verify with `npx vitest run packages/client/src/components/__tests__/ThemeToggle.test.tsx`.
- [ ] 3.2 Rebuild the `ThemePicker.tsx` panel per design D4:
  - `w-[300px]` `@container flex flex-col`, `estimatedWidth: 300`, `usePopoverFlip` bounds on the panel;
  - "Mode" / "Palette" headings (new `common.appearancePalette` key in all three catalogs);
  - a scrolling `grid-cols-2 @max-[239.98px]:grid-cols-1` palette grid with `border-transparent` rows;
  - an 18 × 14 split swatch with an inset ring;
  - active row = `aria-pressed` + selected-chip + `font-semibold`, with no check glyph.

  Verify `PopoverFlip.adopt.test.tsx` still passes.
- [ ] 3.3 Update `components/settings/AGENTS.md` rows for `ThemePicker.tsx` and `ThemeToggle.tsx` (`See change: polish-sidebar-header-controls`); verify the rows mention the segmented mode control and the 300 px grid
- [ ] 3.4 Test: extend `packages/client/src/components/__tests__/ThemePicker.test.tsx` (exemplar: same file). Input: mode Dark, palette Base. Trigger: click `theme-picker-trigger`. Observable:
  - "Mode" and "Palette" visible;
  - Light / System / Dark visible as text;
  - 9 `theme-option-*`, exactly one `aria-pressed="true"` (`base`);
  - the grid has `grid-cols-2`;
  - no `mdiCheck` path in the grid.

  (test-plan #E13)
- [ ] 3.5 Test: extend `ThemePicker.test.tsx` (exemplar: same file). Input: resolved mode light. Trigger: open the dropdown, then switch to dark. Observable: the `theme-option-nord` swatch halves' `backgroundColor` equals nord light `--bg-primary` / `--accent-blue` from `THEMES`, then the nord dark values (test-plan #E14)
- [ ] 3.6 Test: extend `ThemePicker.test.tsx` (exemplar: same file, the existing mode/palette cases). Input: Dark + Base. Trigger: open, click `theme-light`, click `theme-option-nord`, remount. Observable: Light pressed with the dropdown open; then dropdown closed and focus on the trigger; after remount Nord is pressed (test-plan #E15)
- [ ] 3.7 Test: extend `ThemePicker.test.tsx` (exemplar: same file, the keyboard case). Input: preference System. Trigger: focus the trigger, press Enter, then Escape. Observable: focus on `theme-system`; after Escape the dropdown is closed and focus is on the trigger (test-plan #E16)
- [ ] 3.8 Test: add an i18n key check (exemplar: `packages/client/src/__tests__/i18n-inline-other.test.ts`). Input: `common.appearancePalette`, `common.themeLight`, `common.themeSystem`, `common.themeDark`, `connection.switchServerNamed`. Trigger: load the `en` source, `zh-CN` and `hu` catalogs. Observable: each key is present and non-empty in all three (test-plan #E18)
- [ ] 3.9 Test: add an Appearance phone case to `tests/e2e/sidebar-header-fit.spec.ts` (exemplar: its "Narrowest sidebar keeps popovers on-screen" case). Input: viewport 375 × 800, drawer open, active palette Tokyo Night, `pi-dashboard-language` = `en` / `zh-CN` / `hu`. Trigger: open Appearance. Observable: 2 grid columns; every palette-name and mode-label span has `scrollWidth ≤ clientWidth` in each language (test-plan #E17)
- [ ] 3.10 Test: add a short-viewport case to `tests/e2e/sidebar-header-fit.spec.ts` (exemplar: same file). Input: viewport 1280 × 480. Trigger: open Appearance. Observable: the dropdown is inside the viewport; `theme-toggle` is fully inside the dropdown; the palette grid `scrollHeight > clientHeight`, and after scrolling the grid `theme-toggle` is still visible (test-plan #F1)
- [ ] 3.11 Test: extend the narrowest-sidebar popover case in `tests/e2e/sidebar-header-fit.spec.ts` (exemplar: same file). Input: viewport 375 × 800, sidebar 180 px. Trigger: open Appearance. Observable: the dropdown is inside the viewport and no wider than 300 px (test-plan #F2)
- [ ] 3.12 Test: add a one-column case to `tests/e2e/sidebar-header-fit.spec.ts` (exemplar: same file). Input: viewport 320 × 800, drawer open. Trigger: open Appearance. Observable: dropdown width < 254 px, the grid has 1 column track, and the dropdown is inside the viewport (test-plan #F3)
- [ ] 3.13 Test: add an Appearance contrast probe to `tests/e2e/sidebar-header-fit.spec.ts` (exemplar: `tests/e2e/action-menu-tones.spec.ts` + `tests/e2e/helpers/computed-contrast.ts`). Input: `{base,dark}`, `{base,light}`, `{nord,dark}`. Trigger: open Appearance and probe `theme-picker-dropdown`. Observable: the contrast and size failure lists are empty (test-plan #F5)

## 4. Row-1 width budget and fit gate

- [ ] 4.1 In `App.tsx:2297` change the `headerExtra` wrapper to `gap-1`; verify `SessionList.header-declutter.test.tsx` passes
- [ ] 4.2 Make `RuntimeUpdateBadge.tsx` glyph-only in the header: hide the version text and keep it in `title` / `aria-label`. Update `components/packages/AGENTS.md`. Verify with 4.4
- [ ] 4.3 Spike the #E3 long-name fixture. Load the harness through `http://127.0.0.2:<dashboardPort>` and stub `/api/known-servers` with that host labelled `pi-dashboard-31f4d8185a43-studio`. Verify the chip shows the long label. If the listener refuses `127.0.0.2`, stop and write `SHIP_IT_BLOCKED.md` (design Risks)
- [ ] 4.4 Test: extend `packages/client/src/components/__tests__/RuntimeUpdateBadge.test.tsx` (exemplar: same file, `:32,39`). Input: updatable, available `0.12.3`. Trigger: render. Observable: no visible text node `0.12.3`; `title` and `aria-label` contain `0.12.3`; a click navigates to `/settings/add-ons` (test-plan #E12)
- [ ] 4.5 Test: rewrite #E3 in `tests/e2e/sidebar-header-fit.spec.ts` (exemplar: same file, current #E3) using the 4.3 fixture. Input: 1 update, live connection, quiet remote access, no question or waiting device, 34-character label. Trigger: sidebar 279 / 280 / 320 / 411 / 440 / 491 / 500 px. Observable:
  - one shared vertical centre at 280–500;
  - no child past `header-app-bar` at 279;
  - name width ≤ 96 px at 411 / 440 and ≤ 160 px at 491 / 500.

  (test-plan #E3)
- [ ] 4.6 Test: extend #E4 in `tests/e2e/sidebar-header-fit.spec.ts` (exemplar: same file, current #E4). Input: 2 questions, 1 update, offline, tunnel `failed`, 1 waiting device, server "Local". Trigger: sidebar 180 / 280 / 400 / 411 / 491 / 500 px. Observable: every row-1 child inside `header-app-bar`; one shared vertical centre at 400 / 411 / 491 / 500 (test-plan #E4)
- [ ] 4.7 Test: add a tunnel-at-280 case to `tests/e2e/sidebar-header-fit.spec.ts` (exemplar: same file, `installCommonState`). Input: tunnel tone `internet` (stub `/api/tunnel-status`), 1 update, live connection. Trigger: sidebar 280 px. Observable: every row-1 child inside `header-app-bar`; `connection-chip-tone` visible (test-plan #E6)
- [ ] 4.8 Test: add a two-digit update case to `tests/e2e/sidebar-header-fit.spec.ts` (exemplar: same file, `updatesAvailable` stub). Input: update count 12. Trigger: sidebar 280 px. Observable: every row-1 child inside `header-app-bar`; badge text `12` (test-plan #E7)
- [ ] 4.9 Test: add a row-height case to `tests/e2e/sidebar-header-fit.spec.ts` (exemplar: same file). Input: common state. Trigger: sidebar 440 px. Observable: `header-app-bar` height is 44 px (test-plan #F8)
- [ ] 4.10 Update `tests/e2e/sidebar-header-fit.spec.ts.AGENTS.md` and `tests/e2e/helpers/header.ts` (offline-glyph selector) for the new cases; verify `npm run test:e2e -- sidebar-header-fit` is green against the harness

## 5. Contract, tokens and docs

- [ ] 5.1 Add the `icon button (header)` recipe row to `ui-contract.md` with the design D7 exceptions (tap-target, divider-as-group-boundary, right-side gaps, `size-*` steps), and add the "disclosure variant" note to the `menu / flyout` row; verify `node scripts/check-conventions.mjs` passes
- [ ] 5.2 Run `node scripts/theme-token-guard.mjs --write` to shrink the baseline (`FocusToggle.tsx::blue`, and the `ThemeToggle.tsx` / `ThemePicker.tsx` `accentText` entries), then re-run without `--write`; verify exit 0
- [ ] 5.3 Test: ci gate. Input: the changed client files. Trigger: `node scripts/theme-token-guard.mjs`. Observable: exit 0; `FocusToggle.tsx::blue` gone from the baseline; `accentText` counts for `ThemeToggle.tsx` / `ThemePicker.tsx` not above today's (test-plan #E19)
- [ ] 5.4 Delegate the prose update in `docs/architecture.md` (sidebar header section: icon-button recipe, chip server-kind glyph) to DocScribe per AGENTS.md; verify the returned rows are applied

## 6. Integration

- [ ] 6.1 Test: run `packages/client/src/__tests__/mdi-chunk-size.test.ts` (exemplar: same file). Input: the build with 4 new MDI paths. Trigger: `npm run build` then the test. Observable: it passes under `INDEX_GZ_CAP`; if it fails, stop and hand back (no lazy loading, design Risks) (test-plan #E20)
- [ ] 6.2 Run the full suite (`set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`) and `npm run quality:changed`; verify 0 failed
- [ ] 6.3 Run `review-code` on the diff and fix findings; verify no blocking findings remain
- [ ] 6.4 Manual check: row 1, the open Appearance dropdown and the collapsed chip in base dark, base light and nord dark, compared with `mockups/header-icons-appearance`. Operator judgment that glyphs read clearly, the groups are distinct and the popover matches the board; no automatable observable (test-plan: manual-only, #F9)

## Workflow follow-up

- Archive-order check (do at archive, not before). If `group-servers-by-identity` is already archived when this change archives, rebuild `specs/server-selector/spec.md` from the then-current main `openspec/specs/server-selector/spec.md` block "Server selector conforms to the UI contract and shows state in text", replacing only the trigger sentence. Then delete `openspec/changes/group-servers-by-identity/dependencies.yaml` if that change is gone.
- The `group-servers-by-identity` worktree (`.worktrees/os-group-servers-by-identity`) must merge `develop` to pick up its patched trigger sentence and `dependencies.yaml`.
