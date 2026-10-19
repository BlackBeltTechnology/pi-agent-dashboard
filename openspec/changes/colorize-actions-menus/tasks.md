## 1. Shared vocabulary and helper

- [ ] 1.1 `packages/shared/src/dashboard-plugin/ui-primitives.ts`: export `type UiTone = "go" | "create" | "caution" | "danger"`; add `tone?: UiTone` to `UiActionListItem`. Verify: `npx tsc --noEmit -p packages/shared` passes.
- [ ] 1.2 `packages/client-utils/src/tone.ts`: `isUiTone`, `toneIconClass(tone, { disabled })`, `toneRowHoverClass(tone, { disabled })` as `Record<UiTone, string>` literal maps. A tone value is only a lookup key and is never interpolated (design D2). Export it from the package entry. Verify: the folded L1 tests for the helper pass.

## 2. Renderers

- [ ] 2.1 `packages/client-utils/src/ActionList.tsx`: in both menu and inline modes, apply `toneIconClass` to the icon, `toneRowHoverClass` to menu rows, and `data-tone` for a valid tone. Untoned output stays byte-identical. Verify: the folded ActionList tests pass.
- [ ] 2.2 `packages/client/src/lib/session/session-menu-items.ts`: add `tone?: UiTone` to `SessionMenuItem`; set host tones per the spec table (Open PR = create; View PR neutral). Verify: the folded derivation tests pass.
- [ ] 2.3 `packages/client/src/components/session/SessionActionsPanel.tsx`:
  - `MenuEntry`: tone icon class, danger hover/focus, `data-tone`;
  - disabled items drop the colour;
  - NEXT gets the blue tint triple when enabled (design D7);
  - `LifecycleRow` gets a state bar coloured via `statusPresentation`, with skipped = done + `–` (design D6).

  Verify: the folded panel tests pass.
- [ ] 2.4 `packages/client/src/components/folder/FolderActionsMenu.tsx`: add `tone?: UiTone` to `FolderMenuItem`; the row applies the tone icon class, danger hover and `data-tone`; radio items untouched; badge `text-amber-400` → `text-[var(--tint-orange-fg)]`. Verify: the folded folder-menu tests pass.
- [ ] 2.5 `packages/client/src/components/session/SessionList.tsx`: set folder host tones:
  - Add to workspace → create; Enable OpenSpec → create;
  - Clean up broken → caution;
  - Project setup → caution only while an update is pending (same predicate as the `● update` suffix);
  - Remove from workspace → danger.

  Verify: the folded host-tone tests pass.

## 3. Plugin API forwarding and adoption

- [ ] 3.1 `packages/dashboard-plugin-runtime/src/folder-menu-contributions.tsx`:
  - `FolderMenuContribution.tone?: UiTone`;
  - the registration whitelist (`:160-161`) stores `isUiTone(tone) ? tone : undefined`;
  - the hook (`:262-279`) forwards `tone` and adds it to the dependency list.

  Verify: the folded runtime tests pass.
- [ ] 3.2 First-party plugins add tone fields:
  - `goal-plugin/src/client/FolderGoalsSection.tsx` New goal → create;
  - `automation-plugin/src/client/FolderAutomationSection.tsx` New automation → create;
  - `team-plugin/src/client/FolderTeamSection.tsx` Enable team → create, Disable team → danger;
  - `kb-plugin/src/client/FolderKbSection.tsx` Reindex → caution.

  Verify: each plugin's existing tests pass, and the folded plugin-tone test passes.

## 4. Docs and closeout

- [ ] 4.1 CHANGELOG `## [Unreleased]` "Added" entry: optional `tone` on `FolderMenuContribution` and `UiActionListItem`; coloured action menus. Verify: `scripts/check-conventions.mjs` passes.
- [ ] 4.2 Delegate plugin-author docs to DocScribe in caveman style: the folder menu contribution doc (`docs/` + `packages/dashboard-plugin-runtime` README if it documents the contribution type) and the `ui:action-list` primitive doc. Each states the `UiTone` values, their meaning, and the neutral fallback. Verify: the docs name all four tones.
- [ ] 4.3 Update the `AGENTS.md` rows for `tone.ts` (new), `ActionList.tsx`, `SessionActionsPanel.tsx`, `session-menu-items.ts`, `FolderActionsMenu.tsx`, `folder-menu-contributions.tsx` and `ui-primitives.ts` (`See change: colorize-actions-menus`). Verify: `kb dox lint` is clean for these paths.
- [ ] 4.4 Full test run: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`, then grep for the summary. Verify: no new failures.
