# Tasks — fix-kb-settings-reindex-gate

Test tasks below are folded from `test-plan.md`, which is the single source of truth
for automated-vs-manual disposition. Each folded task carries a harness exemplar to
copy glue from, the scenario Triple, and its manifest id.

## 1. Ground truth — confirm the gap before changing anything

- [ ] 1.1 Confirm `packages/kb-plugin/src/client/KbSettingsPanel.tsx:102` mounts `useKbStats(cwd)` and discards `reindex` / `pending` / `reindexError` / the poll-outage channel.
- [ ] 1.2 Confirm `kb-save-reindex` carries `disabled={saving || !dirty}` at `:287` and that no other reindex control exists in the footer.
- [ ] 1.3 Confirm `GET /api/kb/config` returns a `ResolvedConfig` carrying `resolvedSources` (`kb-routes.ts:271`) and that `reindexAll` iterates that same list (`kb-routes.ts:151`). Assert against the server, not the client's assumption.
- [ ] 1.4 Confirm the engine exports TWO `ResolvedSource` interfaces — the wide `sources.ts:19` (re-exported at `index.ts:29`) and the narrow `config.ts:89` that `resolvedSources` actually uses. Record which one `ResolvedConfig` composes before touching any type.
- [ ] 1.5 Confirm `KbSettingsPanel.tsx:101` already binds `error` from `useKbConfig`, so the stats channel must be bound under a different name.
- [ ] 1.6 Run archived `E1`/`E2`/`F4` (`FolderKbSection.test.tsx:108`, `:122`) and record them green BEFORE any edit, so the orthogonality baseline is known.

## 2. Red tests — L1, folded from the manifest

Every task writes a FAILING test before any implementation. Exemplars: extend
`packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx` (panel rendering, mock
`GET /api/kb/config`) and `FolderKbSection.test.tsx` (hook/optimistic-state glue).

- [ ] 2.1 Gate enabled in the nominal case · `origin=project`, `resolvedSources` 1 entry, form pristine, no job · panel renders · `kb-reindex-now` present and not disabled — see `KbSettings.test.tsx` (test-plan #E1)
- [ ] 2.2 Activating rebuilds without saving · same input as #E1 · activate `kb-reindex-now` · `POST /api/kb/reindex?cwd=C` fired exactly once and no `PUT /api/kb/config` fired — see `KbSettings.test.tsx` (test-plan #E2)
- [ ] 2.3 Boundary, zero resolved sources · `resolvedSources` length 0 · panel renders · `kb-reindex-now` present and disabled — see `KbSettings.test.tsx` (test-plan #E3)
- [ ] 2.4 Boundary, one resolved source · `resolvedSources` length 1 · panel renders · `kb-reindex-now` enabled, flipping exactly at the 0↔1 boundary — see `KbSettings.test.tsx` (test-plan #E4)
- [ ] 2.5 Global origin is not stranded · `origin=global`, `resolvedSources` non-empty · panel renders · `kb-reindex-now` enabled AND `kb-copy-parent` + `kb-create-config` still present — see `KbSettings.test.tsx` (test-plan #E5)
- [ ] 2.6 Defaults origin shows a disabled control · `origin=defaults` (resolved necessarily empty) · panel renders · `kb-reindex-now` present and disabled — see `KbSettings.test.tsx` (test-plan #E6)
- [ ] 2.7 Clean form splits the two actions · `resolvedSources` non-empty, pristine · panel renders · `kb-save-reindex` disabled AND `kb-reindex-now` enabled — see `KbSettings.test.tsx` (test-plan #E7)
- [ ] 2.8 Dirty form offers both actions · `resolvedSources` non-empty, dirty · panel renders · both `kb-save-reindex` and `kb-reindex-now` enabled — see `KbSettings.test.tsx` (test-plan #E8)
- [ ] 2.9 False-enable guard · `resolvedSources` empty, a source typed into the form (dirty, unsaved) · panel renders · `kb-reindex-now` still disabled — see `KbSettings.test.tsx` (test-plan #E9)
- [ ] 2.10 False-disable guard · `resolvedSources` non-empty via legacy `roots[]`, `edit.sources` empty · panel renders · `kb-reindex-now` enabled — see `KbSettings.test.tsx` (test-plan #E10)
- [ ] 2.11 Save-in-flight carve-out · `resolvedSources` non-empty, `saving` true · panel renders · `kb-reindex-now` disabled — see `KbSettings.test.tsx` (test-plan #E11)
- [ ] 2.12 Bootstrap banner suppressed when sources resolve · `origin=global`, `resolvedSources` non-empty, faithful mock · panel renders · `kb-bootstrap-note` absent. NOTE this REPLACES the existing inverted assertion at `KbSettings.test.tsx:92`/`:99` — see `KbSettings.test.tsx` (test-plan #E12)
- [ ] 2.13 Bootstrap banner kept when nothing resolves · `origin=defaults`, `resolvedSources` empty · panel renders · `kb-bootstrap-note` present — see `KbSettings.test.tsx` (test-plan #E13)
- [ ] 2.14 Sources notice drops the false prediction · `edit.sources` empty, `resolvedSources` non-empty · panel renders · notice reads "(no sources defined)" and does not contain "nothing will be indexed" — see `KbSettings.test.tsx` (test-plan #E14)
- [ ] 2.15 Sources notice keeps the true warning · `edit.sources` empty, `resolvedSources` empty · panel renders · notice contains "nothing will be indexed" — see `KbSettings.test.tsx` (test-plan #E15)
- [ ] 2.16 Refusal reason is visible, not a tooltip · `resolvedSources` empty · panel renders · the define-a-source explanation is present as visible rendered text near the action, and the assertion is NOT satisfiable by a `title` attribute alone — see `KbSettings.test.tsx` (test-plan #E16)
- [ ] 2.17 Existing save path unchanged · form dirty · activate `kb-save-reindex` · `PUT` with `reindex:true` then `refetchStats()` after the existing 300ms hand-off — see `KbSettings.test.tsx` (test-plan #E17)
- [ ] 2.18 Glyph audit inside the footer · footer rendering both actions · panel renders · `kb-save-reindex` uses `mdiRefresh`, `kb-reindex-now` uses `mdiDatabaseRefreshOutline`, no glyph on both — see `KbSettings.test.tsx` (test-plan #E18)
- [ ] 2.19 Response type is the narrow shape · `KbConfigResponse.config` retyped as `ResolvedConfig` · type-check · `config.resolvedSources` type-checks AND `resolvedSources[0].identity` is a type error. Verify the negative arm actually FAILS before trusting it — a vacuous type assertion proves nothing — see `KbSettings.test.tsx` (test-plan #E19)
- [ ] 2.20 Optimistic disable on click · enabled action · activate once · action becomes disabled synchronously before any server response resolves — see `FolderKbSection.test.tsx` (test-plan #F1)
- [ ] 2.21 No double POST · enabled action · activate twice inside the pending window · `reindexKb` called exactly once — see `FolderKbSection.test.tsx` (test-plan #F2)
- [ ] 2.22 Pending→indexing hand-off has no gap · pending active · `/stats` resolves `indexing:true` · action stays disabled with no intermediate enabled render — see `FolderKbSection.test.tsx` (test-plan #F3)
- [ ] 2.23 Settles to enabled · job in flight · `/stats` resolves `indexing:false` · action converges to enabled — see `FolderKbSection.test.tsx` (test-plan #F4)
- [ ] 2.24 Fast job does not wedge · job settles before the first poll observes it · `REINDEX_GUARD_MS` elapses · action converges to enabled — see `FolderKbSection.test.tsx` (test-plan #F5)
- [ ] 2.25 State does not leak across folders · pending reindex on cwd `A` · navigate the panel to cwd `B` · `B` renders enabled with no error carried from `A` — see `FolderKbSection.test.tsx` (test-plan #F6)
- [ ] 2.26 Trigger rejection is surfaced · `POST /api/kb/reindex` rejects · activate `kb-reindex-now` · `kb-settings-error` renders the reindex trigger error — see `KbSettings.test.tsx` (test-plan #X1)
- [ ] 2.27 Retry is possible after rejection · same fault · after the rejection settles · the action returns to enabled — see `KbSettings.test.tsx` (test-plan #X2)
- [ ] 2.28 One poll blip is tolerated · a single `/api/kb/stats` failure during a running job · that poll misses · no error rendered and busy persists — see `FolderKbSection.test.tsx` (test-plan #X3)
- [ ] 2.29 Sustained outage is surfaced · `/api/kb/stats` fails 3 consecutive times during a job · page settles · `kb-settings-error` surfaces the outage rather than an unexplained idle action — see `FolderKbSection.test.tsx` (test-plan #X4)
- [ ] 2.30 Trigger error outranks poll outage · a reindex rejection and a stats outage both outstanding · panel renders · `kb-settings-error` shows the reindex trigger error — see `KbSettings.test.tsx` (test-plan #X5)
- [ ] 2.31 Bootstrap error outranks trigger error · a bootstrap failure and a reindex rejection both outstanding · panel renders · `kb-settings-error` shows the bootstrap error — see `KbSettings.test.tsx` (test-plan #X6)
- [ ] 2.32 Verify every test in section 2 FAILS before section 3 begins. A test that passes red proves nothing — fix or delete it.

## 3. Implementation — minimum to turn section 2 green

- [ ] 3.1 Retype `KbConfigResponse.config` as `ResolvedConfig` in `packages/kb-plugin/src/shared/kb-plugin-types.ts`. Do NOT hand-declare `resolvedSources` with the publicly re-exported wide `ResolvedSource`.
- [ ] 3.2 Destructure `reindex`, `pending`, `reindexError` from the existing `useKbStats(cwd)` call, binding the poll-outage channel as `statsError` to avoid the `error` redeclaration. Do NOT add a second hook call or panel-local reindex state.
- [ ] 3.3 Derive `busy = pending || stats?.indexing === true` and `canIndex = (data?.config.resolvedSources?.length ?? 0) > 0`.
- [ ] 3.4 Render `kb-reindex-now` in the footer OUTSIDE the `isProject` ternary so both branches carry it.
- [ ] 3.5 Set `disabled={saving || busy || !canIndex}`. Do NOT include `!dirty`.
- [ ] 3.6 Give the action `mdiDatabaseRefreshOutline`, matching the folder menu item's glyph for the same verb.
- [ ] 3.7 Render the define-a-source explanation as visible text beside the action when `!canIndex`.
- [ ] 3.8 Extend the `kb-settings-error` region to `bootstrapErr ?? reindexError ?? error ?? statsError`.
- [ ] 3.9 Gate the `:212` bootstrap banner on `!isProject && !canIndex`.
- [ ] 3.10 Split the `:221` notice into the two variants keyed on `canIndex`.
- [ ] 3.11 Leave `doSave`, `createProjectConfig` and `copyFromParent` untouched.
- [ ] 3.12 Run section 2 green. Any test needing its assertion weakened to pass is a design defect — stop and revisit, do not weaken.

## 4. Orthogonality regression — prove this is not a partial revert of #542

- [ ] 4.1 Pill grid stays state-only · archived `E1` in `FolderKbSection.test.tsx:108` · run UNEDITED · still green, zero focusable elements in the pill grid beyond pill roots — see `FolderKbSection.test.tsx` (test-plan #E20)
- [ ] 4.2 No moved glyph returns to a pill · archived `E2` in `FolderKbSection.test.tsx:108` · run UNEDITED · still green, no `mdiRefresh` inside a pill — see `FolderKbSection.test.tsx` (test-plan #E21)
- [ ] 4.3 Card placement still registers nothing · archived `F4` in `FolderKbSection.test.tsx:122` · run UNEDITED · still green — see `FolderKbSection.test.tsx` (test-plan #E22)
- [ ] 4.4 Confirm `FolderKbSection.tsx` has zero diff in this change. If it needed editing, the design premise is wrong — stop and revisit.
- [ ] 4.5 Confirm no file under `packages/dashboard-plugin-runtime/src/` and no server file is touched.

## 5. E2E — prove the reported complaint is fixed

- [ ] 5.1 Reindex is reachable from the worktree card · docker harness with a worktree session card exposing the KB slot and resolvable sources · activate the slot `→` then `Reindex now` · the settings page for the WORKTREE cwd opens, the action is enabled, and the reindex POST is accepted — see `tests/e2e/kb-folder-slot.spec.ts` (test-plan #F7)
- [ ] 5.2 Read the harness port from `.pi-test-harness.json` (`dashboardPort`); never hardcode `:18000`. Run against a harness reflecting LOCAL changes, and tear it down regardless of outcome.

## 6. Manual verification

- [ ] 6.1 The two footer actions read as distinct and it is obvious which one applies (test-plan: manual-only)

## 7. Verification

- [ ] 7.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep the summary pattern. Do not re-run to inspect errors.
- [ ] 7.2 `npm run quality:changed` clean on the touched files.
- [ ] 7.3 `npm run build && curl -X POST http://localhost:8000/api/restart`, then confirm `/api/health` reports the expected mode.
- [ ] 7.4 Manual pass on a real worktree with a stale index: open the card, follow the `→`, reindex without editing config, watch the count settle.
- [ ] 7.5 Invoke `review-code` on the final diff before commit.
- [ ] 7.6 Invoke `doubt-driven-review` on D1 — the `resolvedSources` gate changes behaviour for `origin=global` and for legacy `roots[]` folders, neither of which anyone filed a bug against.

## 8. Documentation

- [ ] 8.1 Update the `KbSettingsPanel.tsx` purpose row in `packages/kb-plugin/src/client/AGENTS.md`: standalone `Reindex now`, the `resolvedSources` gate, NOT gated on `dirty`, the four-channel error precedence, the two notice variants. Append `See change: fix-kb-settings-reindex-gate`.
- [ ] 8.2 Add a row/breadcrumb in `packages/kb-plugin/src/shared/AGENTS.md` for the `KbConfigResponse.config: ResolvedConfig` retype, noting the two-`ResolvedSource` trap.
- [ ] 8.3 Add a `See change:` breadcrumb to the `useKbStats.ts` row noting the panel is now a second consumer of `reindex`/`pending`, so a future refactor cannot assume the slot is the only caller.
- [ ] 8.4 `kb dox lint` clean for the touched directories.
- [ ] 8.5 CHANGELOG entry under `## [Unreleased]`.
- [ ] 8.6 Any `docs/` prose is delegated to the DocScribe subagent in caveman style; the main agent does not edit `docs/` directly.
