## Context

Both issues were filed with root-cause analysis. Each claim was re-checked against `develop` HEAD.

**#1086 — ended-only unpinned folders stick (verified, with one nuance)**

- Server: `buildSnapshot` counts `endedTotals[g]` for *every* registry session with `status === "ended"`, regardless of the snapshot window (`packages/server/src/session/memory-session-manager.ts:348-353`). It does not look at `hidden`. Archive evicts the session from the registry, so only archiving lowers the count.
- Client: `stubGroupCwds` lists every key with `count > 0` (`packages/client/src/components/session/SessionList.tsx:898-905`) and feeds it to `groupSessionsByDirectory*`, which materialises an empty group for each unpinned key (`packages/client/src/lib/session/session-grouping.ts:144-149`).
- The unpinned tier filter (`SessionList.tsx:3249-3263`) keeps a folder when `any session !== "ended"` **OR** `endedTotalsMap.get(cwd) > 0` **OR** it has archive-search matches. With no folder/tag filter active, the second clause is true for every folder with an unarchived ended session, so the `session-search` rule ("ended-only … hidden", `openspec/specs/session-search/spec.md:50`) never fires.
- Origin: the `endedTotals` clause landed with archived `2026-09-13-fix-connect-snapshot-frame-loss` (commit `cb1d2bb88`, design D9 line 70). That change's design reasoned about stub groups for *pinned/workspace* placement ("workspace placement follows the preference") but its `session-listing` delta wrote "every group key", and it never touched `session-search`. Archived `2026-10-22-declutter-sidebar-header` only reworded the search header and restated the visibility requirement verbatim — not a cause.
- Nuance: the issue says the pinned/workspace case keeps working. True: workspace-claimed folders render from `ws.folders` regardless of pin/alive state (only an active tag filter narrows them, `SessionList.tsx:3198`), pinned groups render unconditionally (`:3225-3232`). Only the *unpinned* filter is wrong. `visibleTopUnpinned` already excludes workspace-claimed folders (`:953-959`).
- Unconfirmed item in the issue — "`endedTotals` does not exclude `hidden` sessions" — **confirmed** (no `hidden` check at `memory-session-manager.ts:348-353`; archived design D9 even records it, "`endedTotals` counts hidden ended sessions"). Effect today: a pinned/workspace folder whose only ended sessions are hidden shows a stub expander that expands to nothing. Out of scope here (see Non-Goals).

**#1085 — eject zone rarely appears (verified, one claim refuted)**

- Gate is exactly `visibleTopPinned.length === 0 && activeDragType === "workspace-folder"` (`SessionList.tsx:3238`). By design (archived `2026-08-05-drag-folders-across-workspaces` D4 — "renders only when the pinned tier is empty … two overlapping eject targets … arbitrary resolution"). Confirmed: with ≥1 pinned folder the zone never shows.
- Claim 2 (gate reads the unfiltered count while the render path filters) — **confirmed**: gate uses `visibleTopPinned.length`, the list renders `visibleTopPinned.filter(folderMatchesFilters)` (`:3225-3232`). A filter that hides every pinned group leaves neither zone nor target.
- Claim 3 (stale `activeDragType`) — **mostly refuted**. `activeDragType` is set in `handleDragStart` (`:1098-1099`) and cleared in both `handleDragCancel` (`:1134-1140`) and `handleDragEnd` (`:1145-1150`). dnd-kit's `PointerSensor` cancels on Escape and on `visibilitychange`. A remount mid-drag loses dnd-kit's own `active` too. The one real hole: the `<DndContext>` is conditionally rendered (`:3139`, empty-state branch); if it unmounts mid-drag without `onDragCancel`, the mirrored state goes stale while the zone's host re-appears. Narrow, but it justifies deriving from dnd-kit state.
- Claim 4 (layout shift): the zone is a `<li>` with `min-height: 64px` (`PinnedTierDropZone.tsx`, `PINNED_TIER_MIN_HEIGHT_PX` in `sidebar-dnd.ts:27`) inserted at drag start, so rows below shift once. `DndContext` already uses `MeasuringStrategy.Always` (`SessionList.tsx:3147`), so droppable rects are remeasured after the shift. The shift is real but does not by itself corrupt collisions.
- The "two overlapping eject targets" worry of D4 does not hold: a `workspace-folder` dropped on a `pinned-group` and on the zone both resolve to `{ kind: "move", toWorkspaceId: null }` (`sidebar-dnd.ts:157-163`, `DRAG_TARGETS["workspace-folder"]` includes both `pinned-group` and `pinned-tier`, `:39-44`). Whichever wins nearest-center, the outcome is identical. D4's premise was ambiguity of *outcome*; there is none.

## Goals / Non-Goals

**Goals**
- Unpinned, non-workspace folders with no alive session are hidden by default; archiving is not required.
- Folder filter, tag filter and archive-search still reveal them, and the ended expander/paging works from there.
- Pinned and workspace folders keep their stub group / ended expander.
- The eject zone is present for every `workspace-folder` drag, with or without pinned folders, with or without a filter hiding them.
- Reconcile `session-listing` with `session-search`.

**Non-Goals**
- Excluding `hidden` sessions from `endedTotals` (server + protocol change; pinned/workspace stubs for hidden-only folders stay as today). Tracked as a follow-up.
- Changing archive semantics, snapshot windowing, or `endedTotals` computation.
- Highlighting pinned groups during a folder drag (they already show `dropIndicatorProps` on hover).
- Fixing the same potential staleness in the FLIP hook's `activeDragType !== null` argument (`SessionList.tsx:1309`); see D4 and Risks.
- Hidden-only ended sessions: because `filterSessions` removes `hidden` sessions before grouping, the visibility change incidentally stops an unpinned hidden-only folder from showing a stub that expands to nothing. Pinned/workspace stubs for hidden-only folders are unchanged (see the first Non-Goal).

## Decisions

### D1 — `session-search` wins; `endedTotals` never reveals an unpinned folder  *(decided 2026-11-03: recommendation accepted)*

Remove the `(endedTotalsMap?.get(g.cwd) ?? 0) > 0` clause from the unpinned tier filter. Keep `g.sessions.some(s => s.status !== "ended")`, the `workspaceFilter`/tag-filter branches, and the archive-match clause. A tag/phase filter keeps its existing semantics (`folderMatchesFilters` needs ≥1 matching held session), so it reveals an ended-only folder through a matching session but can never reveal a stub; the specs say so explicitly. Extract the predicate into a memoised `visibleUnpinned` list used by both the render and the empty-state gate (`SessionList.tsx:3139`), replacing only the `filteredSessions.length === 0` and `!stubGroupCwds` conjuncts of the four-conjunct gate with `visibleUnpinned.length === 0`, so the gate reads `visibleUnpinned.length === 0 && pinnedGroups.length === 0 && (workspaces?.length ?? 0) === 0` (dropping the pinned/workspace conjuncts would show "No active sessions" and unmount the drag subtree for a pinned-only sidebar); otherwise a sidebar whose only folders are hidden-by-this-change would render a blank list instead of "No active sessions". `stubGroupCwds` is still computed (it is needed so a Folders-filter query can reveal an unpinned stub and so pinned/workspace placement keeps working), so grouping and paging code are untouched. Amend the `session-listing` requirement so a stub group renders for a non-zero key only when that group is visible under the `session-search` rules.

Alternatives:
- *`session-listing` wins* (status quo): any folder with an unarchived ended session stays. Sidebar grows monotonically until the user archives; contradicts the product-intended "focus on what you're working on". Rejected.
- *Make ended-only unpinned folders collapse into an "Older folders" fold*: new UI surface, out of scope for a bug fix.
- *Age-based hide (hide after N days ended)*: adds a clock/pref; unspecified in either spec. Rejected.

Rationale: `session-search` states the product intent (focused sidebar; archived `2026-04-28-pin-and-search-sessions` design:89), while the `endedTotals` clause was added by archived `2026-09-13-fix-connect-snapshot-frame-loss` without amending `session-search`. Issue #1086 requests this outcome.

### D2 — Eject zone: render for every `workspace-folder` drag; keep drop-on-pinned-group as an equivalent secondary target  *(decided 2026-11-03: recommendation accepted)*

`SessionList` renders a small child `<WorkspaceFolderEjectZone />` inside `<DndContext>` that calls `useDndContext()` and mounts `<PinnedTierDropZone />` iff `active?.data.current?.type === "workspace-folder"`. No `visibleTopPinned` condition. It sits where the zone sits today (immediately above the pinned tier, `SessionList.tsx:3238`). `DRAG_TARGETS` and `resolveFolderMove` are unchanged.

The child renders the `<li>` wrapper itself, and only while a workspace-folder drag is active, so an idle sidebar gains no empty `<li>` (the `<ul>` uses `flex gap-2`, an always-present empty `<li>` would add a permanent 8px gap and keep the `<ul>` list semantics noisy). It mounts inside `<DndContext>` and inside the `<ul>`.

Placement/shift: render inline (rows below shift once at drag start; `MeasuringStrategy.Always` remeasures). The issue's "no jump" acceptance is relaxed to "rows above the zone never move and collisions use remeasured rects" — see Risks. Decided 2026-11-03 by owner.

Alternatives:
- *Sticky/overlay zone (zero layout shift)*: dnd-kit measures droppable rects once and assumes they scroll with the container; a `position: sticky` or `fixed` zone inside the scroller would be mis-measured after scrolling. A correct version needs a non-scrolling host (hoisting the zone out of `data-session-list-region`) — larger change, deferred unless review insists.
- *Remove drop-on-pinned-group = eject*: breaks a shipped gesture that users know; unnecessary because both targets yield the same outcome.
- *Keep the empty-tier gate but use the filtered count*: fixes issue claim 2 only; the common case (≥1 visible pinned folder) still shows nothing. Rejected.
- *Always reserve a permanent slot*: wastes space when idle.

### D3 — A folder containing the selected session stays visible  *(decided 2026-11-03: recommendation accepted)*

Add `|| (sessionSearch.length === 0 && g.sessions.some(s => s.id === selectedId))` to the unpinned predicate's default branch (no Folders query, no tag/phase filter); under an active Folders/tag filter the filter alone decides, and while a Session search is typed the clause is off, so it never widens the pinned-only intent of `session-search` "Session-search-only mode shows pinned folders only". `g.sessions` is post-`filterSessions`, so a `hidden` selected session (show-hidden off) does not count. Archive search is a Session-search variant, so the clause is off while it is active too (an archive match still keeps the folder via its own clause). Likewise the alive-session clause reads post-`filterSessions` `g.sessions`, so a `hidden` alive session (show-hidden off) does not count as alive (decided 2026-11-03: recommendation accepted). The folder leaves when the selection moves elsewhere or is cleared. Without it, ending the session you are viewing (or opening an ended session from history/search/URL) makes its folder — and the selected card — vanish at once. This is not required by either issue, hence flagged. Alternative: no exception (strictly matches the issue's acceptance "all-ended folder is hidden"); the selected card disappears until the user navigates elsewhere.

### D4 — Derive the zone gate from dnd-kit, keep `activeDragType` for the FLIP hook only  *(design choice, not an owner decision item)*

`useDndContext().active` cannot be called in `SessionList` itself (the provider is rendered by it), so the gate lives in a child. `activeDragType` state stays because `useFlipOnLaneChange` (`SessionList.tsx:1309`) reads it outside the provider. Alternative: keep the mirrored state and only drop the pinned-count condition — smaller diff but leaves the stale-state hole noted under claim 3 for the zone. The chosen option adds one tiny component and removes the gate's dependency on the mirrored state. The same stale value still feeds `useFlipOnLaneChange`; there it can only suppress/allow a lane-change animation, so that residual is accepted (see Risks).

## Risks / Trade-offs

- **Stub-dependent tests/fixtures** assume an unpinned stub is visible by default: `SessionList.folder-menu.test.tsx` "E36: an unpinned stub group renders and sorts last" and the e2e specs `sessions-page-stub-group`, `paging-exhausted-reconnect-rearm`, `paging-empty-reply-exhausted` (`/fixtures/stub-dir` is seeded unpinned, `scripts/seed-sessions-window.mjs:14`). These must pin the folder (unit) or use the Folders filter (e2e: `/fixtures/stub-dir` does not exist on disk, so the `pinDirectory` add-folder helper cannot browse into it). Intentional behavioural change, not a regression.
- **User-visible**: folders that lingered for weeks vanish on upgrade. That is the requested behaviour; sessions remain reachable via the Folders filter and archive search. Mention in release notes.
- **Layout shift (D2)**: inline zone shifts rows below it (pinned and unpinned tiers) by 64px once per drag; rows above never move. Pass criterion in the Playwright populated-pinned spec: after the zone appears, dropping on the zone ejects AND dropping on a pinned group below it still ejects. If remeasure proves insufficient, fall back to a non-scrolling host (alternative above).
- **Stale `activeDragType` in the FLIP hook (D4)**: left as is; impact limited to a lane-change animation in the narrow DndContext-unmount hole. Accepted, not fixed here.
- **Test blast radius**: unit tests that render an unpinned, session-less or ended-only folder with no filter and click its ended toggle will throw once the clause is removed (`SessionList.folder-menu.test.tsx` expanding-a-stub, "does not page when every ended session is already held", "X6 lost reply retried"; `SessionList.test.tsx` F1/F2 paging). Tasks 4.3 and 3.5 sweep every `folder-ended-toggle-` use in unit and e2e tests.
- **Selected-session exception (D3)** adds one more clause to a predicate that issue #1086 is trying to simplify. It is disabled during Session search so the change does not add a new way for an unpinned folder to appear there.
- **Pre-existing gap, not touched**: the main requirement "Session-search-only mode shows pinned folders only" is already not met by the shipped code — a `Session…` query still lists unpinned folders holding a matching *alive* session (the default branch's alive-session clause; noted in `SessionList.header-declutter.test.tsx` E13). This change neither fixes nor widens it: removing the `endedTotals` clause only removes ended-only folders, and the selected-session clause is off during Session search. Reconciling that requirement with the code is a separate follow-up. The empty-state gate (D1) and the "No active sessions" message are unaffected.
- **Session search** (text) without a Folders query already limits to pinned folders per `session-search` spec ("Session search without folder filter limits to pinned"); removing the `endedTotals` clause narrows the implementation toward that rule for ended-only folders only; the alive-session gap above remains (see "Pre-existing gap").

## Migration / Rollback

None: client-only, no persisted state, no protocol/server change. Rollback = revert the commit.
