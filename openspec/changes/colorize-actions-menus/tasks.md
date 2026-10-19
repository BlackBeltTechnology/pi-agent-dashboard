## 1. L1 tests first (red)

Folded from `test-plan.md` (automated, L1). Write each test, see it fail for the expected reason, then implement in sections 2–5.

- [ ] 1.1 E1 `isUiTone` guard (plugin-ui-primitive-registry). Exemplar: packages/shared/src/__tests__/no-primitive-direct-import.test.ts (vitest style). Triple: "go", "create", "caution", "danger", "purple", "", "Danger", "constructor", "__proto__", "toString", 42, null, undefined, {} · call isUiTone(v) · true for exactly the 4 tones; false for every other value (test-plan #E1).
- [ ] 1.2 E2 Total prototype-safe helpers (design D2). Exemplar: packages/client-utils/src/__tests__/statusPresentation.test.ts. Triple: each valid tone × {disabled:false,true}, plus each invalid value from E1 · toneIconClass, toneRowClass, toneAttr · enabled valid tone → the exact literal for its hue (text-[var(--accent-<hue>-text)]); toneRowClass non-empty only for enabled danger (hover+focus bg --tint-red-bg, text --accent-red-text); disabled → "" from both class helpers but toneAttr = tone; any invalid value → "" / undefined; return type always string / UiTone \/ undefined (test-plan #E2).
- [ ] 1.3 E3 Literal-only maps (design D2). Exemplar: packages/client-utils/src/__tests__/statusPresentation.test.ts. Triple: client-utils/src/tone.ts source · read the file · every class appears as a complete literal; no template interpolation of a tone value (test-plan #E3).
- [ ] 1.4 E4 ActionList menu mode honours tone. Exemplar: packages/client-utils/src/__tests__/ActionList.test.tsx. Triple: ActionList inside ActionListMenuContext, actions:[{label:"Delete",icon:"mdiDelete",tone:"danger"}] · render · menuitem has DAT="danger"; the icon carries text-[var(--accent-red-text)]; the row carries the danger hover/focus classes and not hover:bg-[var(--bg-tertiary)] (test-plan #E4).
- [ ] 1.5 E5 ActionList inline mode honours tone. Exemplar: packages/client-utils/src/__tests__/ActionList.test.tsx. Triple: no menu context, actions:[{label:"Run",icon:"mdiPlay",tone:"go"}] · render · the button has DAT="go"; the icon has text-[var(--accent-green-text)]; the label has no tone class (test-plan #E5).
- [ ] 1.6 E6 ActionList invalid tone renders neutral and stays activatable. Exemplar: packages/client-utils/src/__tests__/ActionList.test.tsx. Triple: actions with tone:"purple", "__proto__", 42, each with an onClick spy · render, then click · no DAT; icon has no tone class; spy called once per click; no throw (test-plan #E6).
- [ ] 1.7 E7 ActionList untoned output is unchanged. Exemplar: packages/client-utils/src/__tests__/ActionList.test.tsx. Triple: actions:[{label:"Open",icon:"mdiOpenInNew"}], menu and inline · render, then compare to a snapshot taken before the change · no DAT; no element gains a class="" attribute; snapshot equal (test-plan #E7).
- [ ] 1.8 E8 Session host tones (derivation). Exemplar: packages/client/src/lib/session/__tests__/session-menu-items.test.ts. Triple: deriveSessionMenu for: ended session with sessionFile (Resume, Fork); alive git session (New session, New worktree, Exit); worktree with no PR (Open PR) and with PR #12 + URL (View PR #12); dirty tree (Commit); attached change with Verify, New change, Propose, Archive anyway available · derive · Resume/New session/Verify/Merge = go; Fork/New change/Propose/Open PR = create; New worktree/Commit/Archive anyway = caution; Exit/Close worktree = danger; Rename, Archive session, Push, Switch branch, View PR, Detach, Open change have no tone (test-plan #E8).
- [ ] 1.9 E9 NEXT strips tone, enabled and disabled. Exemplar: packages/client/src/lib/session/__tests__/session-menu-items.test.ts. Triple: (a) Merge-emphasis worktree session; (b) streaming session whose NEXT is Verify · derive · the NEXT item has tone === undefined in both; (a) emphasis true; (b) disabled true, emphasis false; in (a) the OpenSpec primary's home-group copy keeps its tone (test-plan #E9).
- [ ] 1.10 E10 MenuEntry renders tone, NEXT and inert correctly. Exemplar: packages/client/src/components/session/__tests__/SessionActionsMenu.test.tsx (renders the panel). Triple: SessionActionsPanel with groups containing: danger enabled; danger disabled; go enabled; neutral enabled; NEXT enabled (Apply); NEXT disabled · render · danger enabled: DAT="danger", red icon class, danger row classes; danger disabled: DAT="danger", no icon tone class, no hover class at all; go: green icon class; neutral: no DAT, neutral interaction classes; NEXT enabled: data-emphasis="primary", --tint-blue-border border, --accent-blue-text icon, --text-primary semibold label, no DAT, no tinted bg class, has focus:bg; NEXT disabled: no border accent, no DAT (test-plan #E10).
- [ ] 1.11 E11 Keyboard focus background kept on non-danger rows. Exemplar: packages/client/src/components/session/__tests__/SessionActionsMenu.test.tsx. Triple: panel with a neutral item, an inert item, enabled NEXT, and a group with ≥ 2 rare items (renders More…) · render · each of the neutral, inert, NEXT and More… rows has focus:bg-[var(--bg-hover)]; ITEM_BASE no longer contains focus:bg (test-plan #E11).
- [ ] 1.12 E12 Lifecycle row glyph + colour per state. Exemplar: packages/client/src/components/session/__tests__/SessionActionsMenu.test.tsx. Triple: lifecycle segments P done, D done, S skipped, T current, A todo · render LifecycleRow · glyphs ✓ ✓ – ▸ ○; colour classes green-text ×3, yellow-text, --text-tertiary; data-state = done done skipped current todo; accessible names Proposal, done … Archive, todo; skipped and todo stay non-focusable when inert (test-plan #E12).
- [ ] 1.13 E13 Folder host tones. Exemplar: packages/client/src/components/__tests__/FolderActionsMenu.contributions.test.tsx. Triple: FolderActionsMenu items built by SessionList for a folder: in a workspace, with an opted-out OpenSpec (Enable OpenSpec), 2 broken sessions, init status setupOutdated:true then false · render · Enable OpenSpec DAT="create"; Clean up broken (2) DAT="caution"; Project setup DAT="caution" only while setupOutdated; Remove from workspace, Pin, Manage worktrees, Directory Settings, Refresh have no DAT; the add-to-workspace node item has no DAT (test-plan #E13).
- [ ] 1.14 E14 `isProjectSetupOutdated` drives both label and tone. Exemplar: packages/client/src/components/__tests__/FolderActionsMenu.test.tsx. Triple: status {setupOutdated:true}, {setupOutdated:false}, undefined · call isProjectSetupOutdated and projectSetupLabel · true/false/false; the label has the ● update suffix exactly when the predicate is true (test-plan #E14).
- [ ] 1.15 E15 Radio items never toned. Exemplar: packages/client/src/components/__tests__/FolderActionsMenu.radio.test.tsx. Triple: folder menu with the Group-by radio group · render · no menuitemradio carries DAT (test-plan #E15).
- [ ] 1.16 E16 Folder disabled toned item. Exemplar: packages/client/src/components/__tests__/FolderActionsMenu.contributions.test.tsx. Triple: contributed { tone:"caution", disabled:true } · render · DAT="caution", no icon tone class, no hover class (test-plan #E16).
- [ ] 1.17 E17 Badge uses text-role token. Exemplar: packages/client/src/components/__tests__/FolderActionsMenu.test.tsx. Triple: folder item with a badge · render, then scan the rendered markup · badge class contains text-[var(--accent-orange-text)]; no host-rendered element carries a text-amber- (raw palette) class (test-plan #E17).
- [ ] 1.18 E18 Runtime forwards a valid tone. Exemplar: packages/dashboard-plugin-runtime/src/__tests__/folder-menu-contributions.test.tsx. Triple: FolderMenuStore.register(pluginId,{id,group,label,icon,onSelect,tone:"danger"}) · read the registered entry · entry .tone === "danger" (test-plan #E18).
- [ ] 1.19 E19 Runtime neutralises an invalid tone, keeps the item. Exemplar: packages/dashboard-plugin-runtime/src/__tests__/folder-menu-contributions.test.tsx. Triple: register with tone:"purple", tone:"__proto__", tone:{} · read the entries · each entry exists with .tone === undefined; sibling items unaffected (test-plan #E19).
- [ ] 1.20 E20 Runtime whitelist still blocks markup. Exemplar: packages/dashboard-plugin-runtime/src/__tests__/folder-menu-contributions.test.tsx. Triple: register with tone:"go" plus node:<div/> and className:"x" · read the entry · .tone === "go"; no node or className key on the entry (test-plan #E20).
- [ ] 1.21 E21 Hook forwards a live tone change. Exemplar: packages/dashboard-plugin-runtime/src/__tests__/folder-menu-contributions.test.tsx. Triple: useFolderMenuItem rendered with tone:"caution", then re-rendered with tone:undefined · rerender · the store entry's tone changes caution → undefined without unmounting (test-plan #E21).
- [ ] 1.22 E22 KB tone follows action kind. Exemplar: packages/kb-plugin/src/client/__tests__/FolderKbSection.test.tsx. Triple: FolderKbSection folder-menu contribution for kinds pin, missing, configure, retry, busy, index, reindex · render each · DAT="caution" (via the store entry .tone) only for retry, index, reindex; none for the other 4; switching reindex → pin updates the tone (memo dependency) (test-plan #E22).
- [ ] 1.23 E23 Team, goal and automation tones. Exemplar: packages/goal-plugin/src/__tests__/FolderGoalsSection.test.tsx and packages/automation-plugin/src/__tests__/FolderAutomationSection.test.tsx (team: new sibling test copying FolderGoalsSection.test.tsx). Triple: team section for a manageable folder (Team, Team settings, Disable team) and an enableable folder (Enable team for this folder); goal New goal; automation New automation · render, then read the store · Disable team = danger; Enable team = create; New goal = create; New automation = create; Team and Team settings have no tone (test-plan #E23).
- [ ] 1.24 E25 Contrast floors across every palette (design D10). Exemplar: packages/client/src/lib/__tests__/theme-body-text-contrast.test.ts. Triple: base dark/light from index.css + each themes.ts palette × mode · compute WCAG ratios · --accent-{green,blue,orange,red}-text ≥ 3:1 on --bg-secondary; --accent-red-text ≥ 3:1 and ≥ 4.5:1 on --tint-red-bg; --accent-orange-text ≥ 4.5:1 on --bg-secondary; --accent-green-text, --accent-yellow-text, --text-tertiary ≥ 3:1 on --bg-secondary; a synthetic fixture (#8a8a8a on #e1e2e7) fails, proving the assertion bites (test-plan #E25).
- [ ] 1.25 X1 Hostile tone from an untyped intent never reaches the DOM unvalidated. Exemplar: packages/client-utils/src/__tests__/ActionList.test.tsx (render through IntentRenderer as in existing intent tests). Triple: IntentRenderer renders an action-list intent whose action has tone:"danger\" onmouseover=\"x" and another with tone:"go text-[red]" · render · no DAT attribute; no class containing the injected text; the item renders neutral and is activatable (test-plan #X1).
- [ ] 1.26 X2 Old host / new plugin compatibility. Exemplar: packages/dashboard-plugin-runtime/src/__tests__/folder-menu-contributions.test.tsx. Triple: a contribution object carrying tone passed to the *pre-change* whitelist shape (simulated by the store with tone forwarding stubbed off) · register, then render · the item renders neutral and works (degrades, no throw) (test-plan #X2).

## 2. Shared vocabulary and helper

- [ ] 2.1 `packages/shared/src/dashboard-plugin/ui-primitives.ts`: export `UI_TONES` (readonly tuple), `type UiTone`, and `isUiTone(v: unknown): v is UiTone`; add `tone?: UiTone` to `UiActionListItem` (design D2). Verify: `npx tsc --noEmit -p packages/shared` passes and 1.1 (E1) is green.
- [ ] 2.2 `packages/client-utils/src/tone.ts`: total, prototype-safe helpers taking `tone: unknown`. They return `""` unless `isUiTone(tone)`.
  - `toneIconClass(tone, { disabled })` returns `text-[var(--accent-<hue>-text)]`.
  - `toneRowClass(tone, { disabled })` returns, for enabled danger, `hover:` / `focus:` `bg-[var(--tint-red-bg)]` plus `hover:` / `focus:` `text-[var(--accent-red-text)]`.
  - `toneAttr(tone)` returns the validated tone or `undefined`.
  - The maps hold literals only; a tone is never interpolated. Add the `./tone` subpath to `client-utils/package.json` `exports` (design D2, D3). Verify: `npx tsc --noEmit -p packages/client-utils` passes.

## 3. Renderers

- [ ] 3.1 `packages/client-utils/src/ActionList.tsx`:
  - redefine `ExtendedActionItem` as `UiActionListItem & { … }` and add an optional `className` to `IconByKey`, spread only when non-empty;
  - raw `tone` goes only through the helpers and `toneAttr`;
  - both modes: `toneIconClass` on the icon, plus `data-action-tone` for a valid tone;
  - menu rows use `enabledDanger ? toneRowClass : "hover:bg-[var(--bg-tertiary)]"` (design D9).

  Untoned output stays byte-identical. Verify: `npx tsc --noEmit -p packages/client-utils` passes.
- [ ] 3.2 `packages/client/src/lib/session/session-menu-items.ts`:
  - add `tone?: UiTone` to `SessionMenuItem`;
  - strip tone in the NEXT copy (`{ ...item, tone: undefined, emphasis }`);
  - set SESSION/GIT tones inline at each `items.push`: Resume / New session / Merge → go, Fork / Open PR → create, New worktree session / Commit → caution, Exit / Close worktree → danger;
  - add an `OPENSPEC_TONE` map next to `OPENSPEC_ICON` (`:192`): Verify → go, New change / Propose → create, Archive anyway → caution;
  - View PR stays neutral (design D6).

  Verify: `npx tsc --noEmit -p packages/client` passes.
- [ ] 3.3 `packages/client/src/components/session/SessionActionsPanel.tsx`:
  - `MenuEntry`: emphasis first. NEXT gets the outlined style: `--tint-blue-border` border, `--accent-blue-text` icon, semibold neutral label, no `data-action-tone` (design D7).
  - Otherwise: `toneIconClass` on the icon, `data-action-tone={toneAttr(tone)}`, and the three-way row class `enabledDanger ? toneRowClass : enabled ? NEUTRAL_INTERACTION : INERT`. Move `focus:bg` out of `ITEM_BASE` and re-add it in every non-danger branch, including the enabled NEXT branch and the `More…` row at `:300` (design D2).
  - `LifecycleRow`: state bar, glyph and letter in `--accent-green-text` (done `✓`, skipped `–`), `--accent-yellow-text` (current `▸`) or `--text-tertiary` (todo `○`) (design D8).

  Verify: `npx tsc --noEmit -p packages/client` passes.
- [ ] 3.4 `packages/client/src/components/folder/FolderActionsMenu.tsx`:
  - add `tone?: UiTone` to `FolderMenuItem`;
  - rows (dropdown and sheet) apply `toneIconClass`, `data-action-tone`, and `enabledDanger ? toneRowClass : enabled ? neutral hover : disabled`;
  - `node` items and radio items untouched;
  - badge `text-amber-400` → `text-[var(--accent-orange-text)]`.

  Verify: `npx tsc --noEmit -p packages/client` passes.
- [ ] 3.5 `packages/client/src/components/session/SessionList.tsx`: set folder host tones:
  - Enable OpenSpec → create;
  - Clean up broken → caution;
  - Project setup → caution only while `isProjectSetupOutdated(status)`. Extract and export it from `components/folder/folder-menu-labels.ts:24` and use it in `projectSetupLabel` too;
  - Remove from workspace stays neutral (it discards nothing).

  Verify: `npx tsc --noEmit -p packages/client` passes.

## 4. Plugin API forwarding and adoption

- [ ] 4.1 `packages/dashboard-plugin-runtime/src/folder-menu-contributions.tsx`:
  - `FolderMenuContribution.tone?: UiTone`;
  - the registration whitelist (`:160-161`) stores `isUiTone(tone) ? tone : undefined`, importing the guard from `shared`;
  - the hook (`:262-279`) forwards `tone` and adds it to the dependency list;
  - a comment on `isValidFolderMenuContribution` states that `tone` is optional, invalid values are neutralised and the item is never rejected (design D5).

  Verify: `npx tsc --noEmit -p packages/dashboard-plugin-runtime` passes, and the package does not import `client-utils`.
- [ ] 4.2 First-party plugins, using `tone: "…" as const` literals:
  - goal: New goal → create;
  - automation: New automation → create;
  - team: Enable team for this folder → create, Disable team → danger;
  - kb: `tone` derived from `kind` (caution for `index`, `reindex`, `retry`; else none), added to the memo dependencies (design D6).

  Verify: `npx tsc --noEmit -p packages/<plugin>` passes for goal, automation, team and kb, and each plugin's existing tests pass.

## 5. L3 tests (Playwright vs the docker harness)

Folded from `test-plan.md` (automated, L3). Extend `tests/e2e/session-actions-menu.spec.ts` (F1–F8, F11) and `tests/e2e/folder-actions-menu.spec.ts` (F9–F11). Exemplar for palette switching and computed-colour contrast: `tests/e2e/openspec-board-drop-contrast.spec.ts`. Read the harness port from `.pi-test-harness.json` and never hardcode it. Run with the `run-dashboard-e2e-local-changes` skill.

- [ ] 5.1 F1 Danger hover pins the label (session). Triple: alive session s1, menu open · hover **Exit pi session** · DAT="danger"; icon computed colour = resolved --accent-red-text; at rest, label colour = a neutral item's label colour; on hover, background = resolved --tint-red-bg and label = resolved --accent-red-text (test-plan #F1).
- [ ] 5.2 F2 Danger keyboard focus (session). Triple: worktree session menu open · ArrowDown to **Close worktree…** · background = --tint-red-bg; label = --accent-red-text (test-plan #F2).
- [ ] 5.3 F3 Neutral item unchanged. Triple: menu open · read computed styles of **Rename…** · no DAT; icon colour equals label colour (test-plan #F3).
- [ ] 5.4 F4 Disabled toned item looks inert. Triple: session with cwdMissing:true, menu open · hover **New session** · aria-disabled="true", DAT="go"; icon colour ≠ --accent-green-text; background does not change on hover (test-plan #F4).
- [ ] 5.5 F5 NEXT outlined, not filled; Merge in NEXT. Triple: (a) idle session on an IMPLEMENTING change; (b) worktree with an open passing PR (Merge NEXT) · open the menu · NEXT background = menu surface (--bg-secondary); border = resolved --tint-blue-border; icon = --accent-blue-text; no DAT; in (b) the label is Merge (test-plan #F5).
- [ ] 5.6 F6 Disabled NEXT. Triple: streaming session whose NEXT is Verify · open the menu · NEXT aria-disabled="true", no DAT, no blue border (test-plan #F6).
- [ ] 5.7 F7 Lifecycle bars match state and contrast. Triple: change with P, D done, S current, T, A todo · open the menu and read the bar computed colours · P, D bar = --accent-green-text, S = --accent-yellow-text, T, A = --text-tertiary; glyphs ✓ ✓ ▸ ○ ○ visible; each bar ≥ 3:1 vs --bg-secondary computed (test-plan #F7).
- [ ] 5.8 F8 Plugin action-list tone in PLUGINS group. Triple: harness plugin publishes action-list on session-card-action-bar for s1 with {label:"Stop recording", tone:"danger"} · open s1's menu · the PLUGINS menuitem has DAT="danger" and an --accent-red-text icon; activating it closes the menu (test-plan #F8).
- [ ] 5.9 F9 Folder plugin tone end-to-end. Triple: team-managed folder in the harness · open the folder actions menu · **Disable team** has DAT="danger" and a red icon; hover gives --tint-red-bg with a red label; **Remove from workspace** has no DAT (test-plan #F9).
- [ ] 5.10 F10 Tones render in the sheet form. Triple: viewport 390×844, then 1200×560 (short but wide) · open the folder actions menu (sheet) · **Clean up broken (N)** has DAT="caution" and an --accent-orange-text icon in both viewports (test-plan #F10).
- [ ] 5.11 F11 Contrast holds in the browser on low-margin palettes. Triple: base dark, base light, tokyo-night light, catppuccin light · switch palette, open both menus, read computed colours · toned icon colours ≥ 3:1 vs computed --bg-secondary; danger hover label ≥ 4.5:1 vs computed --tint-red-bg; badge ≥ 4.5:1 (test-plan #F11).

## 6. CI / static checks

- [ ] 6.1 E24 Plugin packages typecheck with tone literals. Exemplar: the per-package tsc step in .github/workflows/ci.yml. Triple: goal, automation, team and kb packages after adding tone: "…" as const · npx tsc --noEmit -p packages/<plugin> · exit 0 for all 4 (test-plan #E24).
- [ ] 6.2 E26 Theme token guard has no new findings. Exemplar: the theme-token-guard step in ci.yml / scripts/theme-token-guard.mjs. Triple: repo after the change · node scripts/theme-token-guard.mjs · exit 0; no new accentText or undeclared occurrences (test-plan #E26).

## 7. Manual

- [ ] 7.1 F12 Visual balance (colour overload): both menus, dark and light, two palettes · a human compares against the mockup mockups/actions-menus-tones/ · [judgment: about 4 toned items per menu read as guidance, not noise; NEXT is still the clear primary] (test-plan #F12, manual-only).

## 8. Docs and closeout

- [ ] 8.1 Root CHANGELOG `## [Unreleased]` "Added" entry: optional `tone` on `FolderMenuContribution` and `UiActionListItem`; coloured action menus. Verify: `node scripts/check-conventions.mjs` passes.
- [ ] 8.2 Delegate the plugin-author docs (the folder menu contribution doc and the `ui:action-list` primitive doc) to DocScribe in caveman style. They state the `UiTone` values, their meaning, the neutral fallback and `data-action-tone`. Verify: the docs name all four tones.
- [ ] 8.3 Update the `AGENTS.md` rows for `tone.ts` (new), `ActionList.tsx`, `SessionActionsPanel.tsx`, `session-menu-items.ts`, `FolderActionsMenu.tsx`, `folder-menu-contributions.tsx` and `ui-primitives.ts` (`See change: colorize-actions-menus`). Verify: `kb dox lint` is clean for these paths.
- [ ] 8.4 Full test run: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`, then grep for the summary. Verify: no new failures.
