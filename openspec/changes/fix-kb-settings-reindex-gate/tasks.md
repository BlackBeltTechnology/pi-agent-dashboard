# Tasks — fix-kb-settings-reindex-gate

## 1. Ground truth — confirm the gap before changing anything

- [ ] 1.1 Confirm `packages/kb-plugin/src/client/KbSettingsPanel.tsx` mounts `useKbStats(cwd)` and discards `reindex` / `pending` / `reindexError`; record the current destructure line.
- [ ] 1.2 Confirm `kb-save-reindex` carries `disabled={saving || !dirty}` and that no other reindex control exists in the footer.
- [ ] 1.3 Enumerate the origins the server can return for `GET /api/kb/config` and confirm the footer's `isProject` branch strands at least one origin that has usable `sources[]`. Assert against the server, not against the client's assumption.
- [ ] 1.4 Confirm `FolderKbSection` at `placement="card"` registers nothing (read the code AND run the existing `F4` test) so the baseline for R3 is known-green before edits.

## 2. Red tests — write the enable/disable matrix first

Every task below writes a FAILING test before any implementation.

- [ ] 2.1 Pristine form, `origin=project`, non-empty sources · panel renders · `kb-reindex-now` present and enabled (test-plan #E1)
- [ ] 2.2 Same · activate · `reindexKb(cwd)` called and no config `PUT` issued (test-plan #E2)
- [ ] 2.3 `origin=global`, non-empty sources · panel renders · `kb-reindex-now` present and enabled beside the bootstrap buttons (test-plan #E3)
- [ ] 2.4 `origin=defaults`, non-empty sources · panel renders · `kb-reindex-now` present and enabled (test-plan #E4)
- [ ] 2.5 `sources[] = []` · panel renders · `kb-reindex-now` present, disabled, `title` names the define-a-source remedy (test-plan #E5)
- [ ] 2.6 Same · the element is NOT absent from the DOM (test-plan #E6)
- [ ] 2.7 Dirty form, non-empty sources · panel renders · BOTH `kb-reindex-now` and `kb-save-reindex` enabled (test-plan #E7)
- [ ] 2.8 Pristine form · `kb-save-reindex` still disabled while `kb-reindex-now` is enabled (test-plan #E8)
- [ ] 2.9 Dirty form · activate `kb-save-reindex` · existing `save({...patch, reindex:true})` + delayed `refetchStats()` behaviour is unchanged (test-plan #E9)
- [ ] 2.10 `reindexKb` rejects · activate · the panel renders the `reindexError` text (test-plan #X1)
- [ ] 2.11 Same · after the rejection settles · the action is enabled again (test-plan #X2)
- [ ] 2.12 A single `/api/kb/stats` poll miss during a job · no error rendered, busy persists (test-plan #X3)
- [ ] 2.13 Activate once · the action disables synchronously, before any server response (test-plan #S1)
- [ ] 2.14 Activate twice within the pending window · `reindexKb` called exactly once (test-plan #S2)
- [ ] 2.15 Poll reports `indexing:true` · disabled across the pending→indexing hand-off with no enabled gap (test-plan #S3)
- [ ] 2.16 Poll reports `indexing:false` · the action re-enables (test-plan #S4)
- [ ] 2.17 Job settles before the first poll · after `REINDEX_GUARD_MS` the action re-enables, no permanent wedge (test-plan #S5)
- [ ] 2.18 Footer renders both actions · `kb-save-reindex` uses `mdiRefresh`, `kb-reindex-now` uses `mdiDatabaseRefreshOutline`, no glyph twice (test-plan #R4)
- [ ] 2.19 Pending reindex on cwd `A`, navigate to cwd `B` · `B` is enabled and shows no error from `A` (test-plan #Q1)
- [ ] 2.20 Verify every test in section 2 FAILS before section 3 begins. A test that passes red is proving nothing — fix or delete it.

## 3. Implementation — minimum to turn section 2 green

- [ ] 3.1 Destructure `reindex`, `pending`, `reindexError` from the existing `useKbStats(cwd)` call. Do NOT add a second hook call or panel-local reindex state (design D3).
- [ ] 3.2 Derive `busy = pending || stats?.indexing === true` and `canIndex = edit.sources.length > 0`.
- [ ] 3.3 Render the `kb-reindex-now` action in the footer OUTSIDE the `isProject` ternary so both branches carry it (design D1).
- [ ] 3.4 Set `disabled={saving || busy || !canIndex}`. Do NOT include `!dirty` (design D2).
- [ ] 3.5 Give the action `mdiDatabaseRefreshOutline`, matching the folder menu item's glyph for the same verb (design D4).
- [ ] 3.6 Provide the two titles: the empty-sources remedy when `!canIndex`, the rebuild-from-saved-config description otherwise.
- [ ] 3.7 Surface `reindexError` inline in the panel, reusing the existing `bootstrapErr` presentation rather than inventing a second error region.
- [ ] 3.8 Leave `doSave`, `createProjectConfig` and `copyFromParent` untouched.
- [ ] 3.9 Run section 2 green. Any test needing its assertion weakened to pass is a design defect — stop and revisit, do not weaken.

## 4. Orthogonality regression — prove this is not a partial revert of #542

- [ ] 4.1 Re-run archived `E1` (zero focusable elements in the pill grid beyond pill roots) UNTOUCHED · still green (test-plan #R1)
- [ ] 4.2 Re-run archived `E2` (no `mdiRefresh` inside a pill) UNTOUCHED · still green (test-plan #R2)
- [ ] 4.3 Re-run archived `F4` (card placement registers nothing) UNTOUCHED · still green (test-plan #R3)
- [ ] 4.4 Confirm `FolderKbSection.tsx` has zero diff in this change. If it needed editing, the design premise is wrong — stop and revisit.
- [ ] 4.5 Confirm no file under `packages/dashboard-plugin-runtime/src/` (`SlotPill`, folder-menu contributions) is touched.

## 5. E2E — prove the reported complaint is fixed

- [ ] 5.1 Add a Playwright spec: worktree session card → KB slot `→` → settings page opens for the worktree cwd → `Reindex now` is enabled → activating it is accepted (test-plan #Q2).
- [ ] 5.2 Run it against the docker harness reflecting LOCAL changes (not a cached image); tear the harness down afterwards regardless of outcome.

## 6. Verification

- [ ] 6.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep the summary pattern. Do not re-run to inspect errors.
- [ ] 6.2 `npm run quality:changed` clean on the touched files.
- [ ] 6.3 Rebuild per the client path: `npm run build && curl -X POST http://localhost:8000/api/restart`, then confirm `/api/health` reports the expected mode.
- [ ] 6.4 Manual pass on a real worktree with a stale index: open the card, follow the `→`, reindex without editing config, watch the count settle.
- [ ] 6.5 Manual pass on a folder with empty sources: confirm the action is visible, disabled, and its title explains the remedy.
- [ ] 6.6 Invoke `review-code` on the final diff before commit (proposal Discipline Skills).
- [ ] 6.7 Invoke `doubt-driven-review` on D1 specifically — the `sources.length` gate changes behaviour for `origin=global`, which nobody filed a bug against.

## 7. Documentation

- [ ] 7.1 Update the `KbSettingsPanel.tsx` purpose row in `packages/kb-plugin/src/client/AGENTS.md`: note the standalone `Reindex now`, the `sources.length` gate, and that it is NOT gated on `dirty`. Append `See change: fix-kb-settings-reindex-gate`.
- [ ] 7.2 Add a `See change:` breadcrumb to the `useKbStats.ts` row noting the panel is now a second consumer of `reindex`/`pending`, so a future refactor cannot assume the slot is the only caller.
- [ ] 7.3 `kb dox lint` clean for the touched directory.
- [ ] 7.4 CHANGELOG entry under `## [Unreleased]`.
- [ ] 7.5 Any `docs/` prose (if the FAQ gains a "how do I rebuild a stale KB" entry) is delegated to the DocScribe subagent in caveman style; the main agent does not edit `docs/` directly.
