## Why

Two sidebar defects, both regressions from archived changes that never reconciled the specs they touched.

- **#1086** — an unpinned, non-workspace folder stays in the sidebar until every session in it is *archived*, not merely ended. The `session-search` requirement "Visibility rules for unpinned folders" says ended-only unpinned folders are hidden by default; the `session-listing` requirement "Browser pages older ended sessions on demand" (added by archived `2026-09-13-fix-connect-snapshot-frame-loss`) says a folder group is rendered for every non-zero `endedTotals` key. The client implements the latter as an extra visibility clause, so the former never fires.
- **#1085** — the "Drop here to remove from workspace" eject zone (`PinnedTierDropZone`) only mounts when the pinned tier is empty (archived `2026-08-05-drag-folders-across-workspaces`, D4). Anyone with one pinned folder never sees it, and with a sidebar filter hiding every pinned group there is no visible eject target at all.

## What Changes

- **Visibility (#1086):** an unpinned, non-workspace folder is visible by default only when it holds an alive session or, outside any Folders/tag filter and Session search, the currently selected session (plus the existing folder-filter, tag-filter and archive-match clauses). `endedTotals > 0` alone no longer reveals it. Stub groups and the ended expander/paging still work for pinned and workspace folders and for unpinned folders revealed by the Folders filter or an archive-search match. `session-listing` is amended so stub groups follow `session-search` visibility. The sidebar empty-state gate counts visible folders, so a sidebar whose every folder is hidden shows "No active sessions" rather than a blank list. Decisions D1–D3 were accepted by the owner (2026-11-03); see design.md.
- **Eject zone (#1085):** `PinnedTierDropZone` renders for every `workspace-folder` drag regardless of how many pinned folders exist or whether a filter hides them. Dropping a folder on a pinned group still ejects (same outcome as the zone, so the two targets cannot conflict). The `SessionList` gate moves from a mirrored `activeDragType` + `visibleTopPinned.length` to a child component reading dnd-kit's `useDndContext().active`.
- Specs: `sidebar-drag-reorder` eject scenario no longer forbids the zone alongside pinned groups.
- No server, protocol or persistence change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `session-search`: "Visibility rules for unpinned folders" — `endedTotals`/stub groups do not reveal an unpinned folder; selected-session, tag-filter and empty-state clauses stated; scenarios added.
- `session-listing`: "Browser pages older ended sessions on demand" — stub group rendering is subject to the sidebar visibility rules; stub scenario narrowed, unpinned-hidden scenario added.
- `sidebar-drag-reorder`: "Drag folders across workspace boundaries" — eject zone present for every workspace-folder drag; scenarios added.

## Impact

- `packages/client/src/components/session/SessionList.tsx` (unpinned tier filter ~L3249–3263, extracted into a memoised visible-unpinned list that also feeds the empty-state gate ~L3139; eject-zone mount ~L3238; a small child component for the zone)
- `packages/client/src/components/workspace/PinnedTierDropZone.tsx` (doc comment; possibly the gate wrapper)
- `packages/client/src/lib/layout/sidebar-dnd.ts` (comment only; `DRAG_TARGETS` unchanged)
- Tests: `packages/client/src/components/__tests__/SessionList.test.tsx` (F1/F2 paging tests use an unpinned, session-less folder), `SessionList.folder-menu.test.tsx` (E36 plus the unpinned stub/ended-only paging tests), `SessionList.folder-membership-drag.test.tsx`; e2e: `tests/e2e/sessions-page-stub-group.spec.ts`, `paging-exhausted-reconnect-rearm.spec.ts`, `paging-empty-reply-exhausted.spec.ts` (all rely on the unpinned seeded `/fixtures/stub-dir`, `scripts/seed-sessions-window.mjs:14`), `tests/e2e/folder-membership-drag.spec.ts` (populated-pinned case)
- Per-directory `AGENTS.md` rows for the two components (closeout)

## Discipline Skills

- `systematic-debugging` — both items are regressions; tasks reproduce each with a failing test before the fix.
- `review-code` — non-trivial client change, run before commit.
- `doubt-driven-review` — design D1 resolves a spec conflict (which spec wins); sanity-check before it stands.
- No security, performance or observability checkpoints apply (client-only, no new endpoint or untrusted input).

Fixes #1086
Fixes #1085
