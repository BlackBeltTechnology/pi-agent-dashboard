## 1. Shared types & protocol

- [ ] 1.1 Add `GroupByMode`, `LaneId`, `isGroupByMode`/`isLaneId` guards to `packages/shared/src` and verify with a unit test covering valid + invalid values
- [ ] 1.2 Add `SetFolderGroupByMessage` (`set_folder_group_by {path, mode|null}`), `SetDefaultGroupByMessage`, `SetLaneCollapsedMessage` to `BrowserToServerMessage` and `GroupByPrefsUpdatedMessage` (`group_by_prefs_updated`) to `ServerToBrowserMessage` in `browser-protocol.ts`; verify `npx tsc --noEmit -p packages/shared` passes; update `browser-protocol.ts.AGENTS.md`

## 2. Server persistence & wiring

- [ ] 2.1 Write failing tests in the preferences-store test suite: load absent fields ⇒ defaults; set/clear folder mode with canonical key (trailing-separator + separator-style spellings collapse); set default; set/clear lane collapse; invalid mode rejected with no write; entries for folders without loaded sessions never pruned; invalid values dropped on load
- [ ] 2.2 Implement `defaultGroupBy` / `folderGroupBy` / `collapsedLanes` in `preferences-store.ts` (load, validate, canonicalize via the `collapsedFolders` `inferPlatform`+`pathKey` path, include in every `writeJsonFile` payload, getters/setters returning "changed" boolean) and verify 2.1 passes
- [ ] 2.3 Handle the three new browser messages in the gateway (validate → mutate → broadcast `group_by_prefs_updated` only on real change) and send `group_by_prefs_updated` in the connect burst right after `collapsed_folders_updated`; verify with a gateway test asserting burst ordering and no-broadcast on invalid/no-op input
- [ ] 2.4 Restart server (`curl -X POST http://localhost:8000/api/restart`) and verify a WS client receives `group_by_prefs_updated` before `pinned_dirs_updated`

## 3. Client pure logic

- [ ] 3.1 Write failing tests for `classifyStatusLane(s, flags)` as a wrapper over `deriveStatusShape` (error / needs-you / working incl. compacting+retrying+resuming / notice→review / unread idle→review / idle; ended excluded; widget-bar suppression honored; lane order `needs-you, error, working, review, idle`) and `classifyLocationLane`
- [ ] 3.2 Write failing tests for `partitionIntoLanes(sessions, mode, order)`: lane order, relative stored order kept, unordered appended by startedAt desc, empty lanes omitted, `none` ⇒ single lane
- [ ] 3.3 Write failing tests for `mergeLaneOrder(storedOrder, laneIds, newLaneOrder)` slot-preserving merge incl. ids missing from stored order
- [ ] 3.4 Write failing tests for `resolveEffectiveGroupBy(folderKey, prefs)` (override > default > none, canonical key lookup)
- [ ] 3.5 Implement 3.1–3.4 in `packages/client/src/lib/session/session-grouping.ts` (or a sibling `session-lanes.ts`) and verify all pass; update the directory `AGENTS.md` row

## 4. Client state & hooks

- [ ] 4.1 Add grouping-prefs client state fed by `group_by_prefs_updated` with actions sending the three messages (explicit target state); verify with a reducer/store unit test
- [ ] 4.2 Implement `useLaneHysteresis` (~3000 ms hold on demotion out of `working`, immediate to/from `needs-you`, timers cleared on unmount); verify with fake-timer tests incl. "re-enters working within hold ⇒ no move"
- [ ] 4.3 Implement `useFlipOnLaneChange` (no dependency; skipped under `prefers-reduced-motion` and during drag); verify with a test that mocks `matchMedia` reduce ⇒ no transform applied
- [ ] 4.4 Implement one-shot urgency migration (after first `group_by_prefs_updated`: legacy folders without explicit mode ⇒ `set_folder_group_by status`; then remove `dashboard:folder-urgency-sort`); verify tests for migrate, no-overwrite, and no-clear-before-snapshot

## 5. Client UI

Reference: `mockups/ui-plan.md` + live mockup `mockups/index.html` — match its tokens, anatomy and states 1:1.

- [ ] 5.0 Add `--status-unread` theme token (dark `#22d3ee`, light `#0891b2`) to `index.css` and switch `.card-stripes-unread` to it; verify the unread stripe renders unchanged in dark and the theme token test (if any) passes

- [ ] 5.1 Create `LaneHeader` component: status-shape glyph on the rail (`statusShapeIcon`), label in `--text-secondary` (never status color), branch sub for Main checkout, count pill, right chevron, `<button aria-expanded aria-controls>`; collapsed → count only (status lanes) / count + `FolderStatusCapsule`-style rollup (location lanes); selected-session marker; 44 px on coarse pointer. Verify with RTL tests for keyboard toggle, aria state, rollup rule, and selected marker
- [ ] 5.2 Wire lanes into the `SessionList.tsx` render pipeline: effective mode → hysteresis-adjusted partition → per-lane `SortableContext`; ≤1 non-empty lane ⇒ unchanged DOM; search/tag filter ⇒ existing flat path; ended bucket untouched; verify existing SessionList tests still pass plus new tests for status and location lanes
- [ ] 5.3 Drag handling: within-lane drop ⇒ `mergeLaneOrder` ⇒ `onReorderSessions`; cross-lane hover ⇒ deny outline on target lane; cross-lane drop ⇒ ignored + explanatory toast (status vs location wording); ended-bucket → lane ⇒ existing drag-to-resume; verify with drag-end handler unit tests incl. toast text
- [ ] 5.4 Collapsed lanes: persist via `set_lane_collapsed`; folder collapse hides lanes and restores each lane state; seek/reveal expands target lane; background move into collapsed lane does not expand; include lane id in `selectedCardScrollFingerprint`; verify with tests for each scenario
- [ ] 5.4b Hold visual + announcements: held card renders new status + destination-colored countdown underline (static under reduced motion); selected-card lane change emits a polite live-region message and scrolls into view; verify with fake-timer RTL test and a live-region assertion
- [ ] 5.4c Folder header mode chip on the path row (`<Mode>` / `<Mode> · default`, hidden for `none`, visible when collapsed / single-lane), activating it opens the folder menu focused on the checked item; verify with RTL test
- [ ] 5.5 Folder actions menu: replace `urgency-sort` item with a "Group by" radio set (`None`/`Status`/`Location`/`Use default (<Mode>)`) with selected state exposed; remove `useFolderUrgencySort` usage (delete hook + test if orphaned); verify menu test
- [ ] 5.6 Settings panel "Default grouping" select sending `set_default_group_by`; verify RTL test
- [ ] 5.7 Add i18n keys (en/hu/zh) for lane labels, menu items, setting label; verify i18n completeness test passes

## 6. Verification & docs

- [ ] 6.1 Run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and verify zero failures
- [ ] 6.2 Run `npm run quality:changed` and verify no new Biome findings
- [ ] 6.3 `npm run build && curl -X POST http://localhost:8000/api/restart`; manually verify in the browser against `mockups/index.html` side by side: Status lanes with live sessions, hysteresis between turns, Location lanes, cross-lane drop snaps back, reload keeps modes, second browser updates live, reduced-motion disables animation
- [ ] 6.4 Invoke `review-code` on the diff and resolve findings; invoke `performance-optimization` check that status ticks with ~15 alive sessions cause no re-partition when only token/cost fields change (React profiler or render-count test)
- [ ] 6.5 Update per-file `AGENTS.md` rows for every touched file; delegate `docs/` prose (sidebar grouping section in architecture/faq) to DocScribe; add CHANGELOG `[Unreleased]` entry noting BREAKING (UI) urgency-toggle removal
