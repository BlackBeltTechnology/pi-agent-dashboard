## Why

A folder group renders its alive sessions as one flat list ordered by the server's recency-driven `sessionOrder` (`moveToFront` on spawn/resume/reattach). With many concurrent sessions in one repo (worktree sessions fold under `gitWorktree.mainPath`), the list reshuffles constantly and offers no way to see at a glance which sessions need the user, which are working, and which are idle — or which run in a worktree versus the main checkout. Navigation is the primary job of the sidebar, so the user needs a stable, user-chosen arrangement that persists across reloads and devices.

## What Changes

- Add a per-folder **Group by** control (radio group in the folder actions menu): `None` (today's behaviour), `Status`, `Location`.
- **Status** mode splits the folder's alive sessions into lanes — `Needs you` (chat-routed ask_user) → `Working` (streaming / compacting / resuming) → `To review` (unread) → `Idle`; ended sessions stay in the existing collapsed ended bucket.
- **Location** mode splits into two fixed lanes — `Main checkout · <branch>` and `Worktrees` (sessions with `gitWorktree` set).
- Lane rendering rules: empty lanes hidden; no lane headers when only one lane is non-empty (folder looks like today); lane headers are collapsible with count + status rollup; lanes flatten while a session search or tag/phase filter is active.
- Order within a lane is a stable partition of the stored `sessionOrder` (same technique as the alive/ended split); drag-reorder works within a lane only, cross-lane drops are rejected.
- Status-mode stability: lane demotion (e.g. Working → To review / Idle) is delayed by a short hysteresis window; promotion to `Needs you` is immediate; the selected card stays in view; lane moves animate unless `prefers-reduced-motion`.
- **Persistence (server-side)**: per-folder mode and lane collapse state stored in `preferences.json`, keyed by canonical `pathKey`, delivered in the initial snapshot (no flat→lanes flash), shared across browsers/devices.
- **Global default**: a `Default grouping` preference (`none` | `status` | `location`, default `none`) applied to every folder without an explicit per-folder override; a folder can "Use default" to drop its override.
- **BREAKING (UI)**: the per-folder "Float blocked sessions to top" toggle (localStorage) is removed — Status mode's `Needs you` lane supersedes it. A one-shot migration gives each folder that had it enabled an explicit `status` mode (unless it already has an explicit mode).

## Capabilities

### New Capabilities
- `session-list-group-by`: per-folder Group-by modes (None / Status / Location), lane assignment rules, lane rendering/ordering/drag/hysteresis behaviour, per-folder override + global default resolution.

### Modified Capabilities
- `session-grouping`: within-group ordering is no longer solely the flat server order when a grouping mode is active — lanes partition it.
- `global-preferences`: `preferences.json` gains `folderGroupBy` (pathKey → mode), `defaultGroupBy`, and `collapsedLanes`; keys are never pruned for folders lacking loaded sessions.
- `collapsible-groups`: lane headers inside a folder are collapsible and persisted server-side under canonical `<pathKey>::<lane>` keys.

## Impact

- **Client**: `packages/client/src/components/session/SessionList.tsx` (render pipeline, folder actions menu), `packages/client/src/lib/session/session-grouping.ts` (pure lane partition + status classifier), `useFolderUrgencySort.ts` (reconcile/migrate), new lane header component, settings UI for the global default, i18n keys (en/hu/zh).
- **Shared**: `packages/shared/src/browser-protocol.ts` — new browser→server messages to set a folder's mode / the default / lane collapse, and snapshot fields.
- **Server**: preferences store + WS handlers + broadcast; reuse `pathKey` from `packages/shared/src/session-group-path.ts`.
- **Compatibility**: all new preference fields optional; absent ⇒ `none` ⇒ today's behaviour. Older servers ignore the fields. **Rollback**: reverting leaves unused fields in `preferences.json`, no data loss.
- No change to server `sessionOrder` semantics or persistence.

## Discipline Skills

- `performance-optimization` — Status mode re-partitions on every status tick across many sessions; lane classification + hysteresis must stay cheap and not cause re-render storms.
- `review-code` — non-trivial client render-pipeline change before commit.
- No `security-hardening` / `observability-instrumentation` trigger: no auth, untrusted input, or new external calls (new WS messages carry enum values validated server-side).
