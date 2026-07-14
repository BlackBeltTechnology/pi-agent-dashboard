# Tasks

## 1. DisplayPrefs field (chat-display-preferences)

- [x] 1.1 Add `reserveProcessLineAtIdle: boolean` to `DisplayPrefs` in `packages/shared/src/display-prefs.ts` (with docstring). → verify: `tsc --noEmit` fails until presets updated.
- [x] 1.2 Add the field to all three `DISPLAY_PRESETS` (`simple`/`standard` = `false`, `everything` = `true`). → verify: type-checks.
- [x] 1.3 Add the merge line to `mergeDisplayPrefs` (`override.reserveProcessLineAtIdle ?? global.reserveProcessLineAtIdle`). → verify: merge unit test.
- [x] 1.4 Unit test: `mergeDisplayPrefs` carries the new field (override wins; absent → global); presets have expected values.

## 2. Settings surfaces

- [x] 2.1 `SettingsPanel.tsx` — global `<ToggleField label="Reserve process line at idle">` wired to `patch({ reserveProcessLineAtIdle })`.
- [x] 2.2 `ChatViewMenu.tsx` — per-session override `<Row … marked={isOverridden("reserveProcessLineAtIdle")}>`.
- [x] 2.3 i18n keys for both labels.

## 3. Shared collapse-summary helper (DRY)

- [x] 3.1 Extract the summary-row primitive currently inline in `ProcessList` (`summaryRow` + `computeVisibleRows` overflow) into a shared `collapse-summary` helper.
- [x] 3.2 Unit test the helper (collapsed shows summary only; expanded shows rows + `+N`).

## 4. Unified summary line in ProcessSubcard (session-card-subcards)

- [x] 4.1 Compose the collapsed line: primary running cmd (newest bash) OR `⚠ M background…` OR `⏵ idle`; stable-width counts pill `[N running · ⚠M]`; elapsed.
- [x] 4.2 Expanded body = activity rows (`⏹` → session abort) then bg rows (`✕` → PGID kill), reusing the collapse-summary helper.
- [x] 4.3 Drive expand/collapse from the existing `useDrawerExpansion` / `processDrawerCollapsed` (single toggle for the whole region).
- [x] 4.4 Gate idle reservation: `if (!hasActivity && !hasProcesses && !prefs.reserveProcessLineAtIdle) return null;` else render reserved idle line. `prefs = useDisplayPrefs(session.id)`.
- [x] 4.5 `SessionActivityBar` contributes running count + rows to the unified line (no longer an always-open standalone stack).
- [x] 4.6 `ProcessList` contributes bg count + rows; its standalone `⚠ N` summary row is removed in favour of the unified line.

## 5. Tests

- [x] 5.1 Update `SessionActivityBar.test.tsx` for the new contribute-to-summary shape.
- [x] 5.2 Update `ProcessList.test.tsx` (summary folded into unified line).
- [x] 5.3 Update `SessionCard.test.tsx` snapshots.
- [x] 5.4 **Regression (core goal):** collapsed `ProcessSubcard` height is invariant across `activity=[]`, `[1]`, `[1,2,3]` — height MUST NOT depend on tool count.
- [x] 5.5 Pref gating test: `reserveProcessLineAtIdle=false` + both empty → null; `true` → reserved idle line.

## 6. Verify / Manual

- [x] 6.1 `npm test` green.
- [x] 6.2 `npm run quality:changed` clean.
- [ ] 6.3 Manual: run a bash-heavy session in the dashboard; confirm neighbour cards do not jump on tool start/stop (both pref states). Compare against mockup `mockups/index.html`.
