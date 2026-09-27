## Context

See proposal.md — Why. Current state relevant to the approach:

- `SessionList.tsx` render pipeline (≈L1860–1990) builds per-folder `activeSessions` / `endedSessions` via `sortSessionsByOrder(…, sessionOrderMap.get(group.cwd))` — a stable partition of the stored flat order — then renders one `SortableContext` over `[...active, ...ended?]`.
- Urgency sort (`useFolderUrgencySort`, localStorage key `dashboard:folder-urgency-sort`) floats `ask_user` sessions via `floatAskUserFirst`; exposed as a `pressed` item in the folder actions menu.
- Folder collapse is server-owned: `preferences-store.ts` (`collapsedFolders`, canonical `pathKey` + `inferPlatform`), `set_folder_collapsed` / `collapsed_folders_updated` in `browser-protocol.ts`, sent first in the connect burst (`browser-gateway.ts`).
- Status signals already on `DashboardSession`: `status`, `currentTool` (via `isChatRoutedAskUser`), `compacting`, `resuming`, `unread`, `gitWorktree`.
- Drag uses `@dnd-kit/core` + `@dnd-kit/sortable`; no animation library in the client.

## Goals / Non-Goals

**Goals:**
- Pure, unit-testable lane classification + partition; the render pipeline only consumes its output.
- Server-owned grouping prefs that follow the exact `collapsedFolders` pattern (canonical key, connect-burst ordering, no orphan pruning).
- Zero behaviour change when effective mode is `none`.

**Non-Goals:**
- Group-by-change (attachedProposal clusters) and the plan↔ship twin-link chip — follow-up changes.
- Nested grouping (e.g. Location then Status).
- Lanes inside workspace-level views beyond what the folder group already renders (a folder inside a workspace uses the same folder rendering, so it gets lanes for free; no workspace-level lanes).
- Changing server `sessionOrder` semantics.

## Decisions

### D1 — Lanes are a client-side view over the unchanged stored order
Lane assignment is derived in the client from session fields; the server never stores lane membership. `partitionIntoLanes(sessions, mode, order)` returns `{ laneId, sessions }[]` in lane order, each lane = `sortSessionsByOrder(members, order)`.
*Alternative:* per-lane server order arrays — rejected: status lanes change membership every turn, would churn `preferences.json` and duplicate `sessionOrder`.

### D2 — Classifier precedence
`classifyStatusLane(s, flags)` wraps the existing `deriveStatusShape(s, flags)` (`session-status-visuals.ts`) so lanes, card dots and the folder capsule can never disagree: `error`→`error`, `needs-you`→`needs-you`, `working`→`working` (plus `s.compacting` → `working`, which `deriveStatusShape` does not cover), `notice`→`review`, `idle`→ (`s.unread` ? `review` : `idle`), `ended`→ excluded (stays in the ended bucket). `flags` (`hasError`, `isRetrying`, `hasWidgetBarPrompt`, `hasNotice`) are threaded from the same maps `SessionCard` already receives (`errorSessionIds`, `retrySessionIds`, `noticeSessionIds`, widget-bar hook). Lane order = `CAPSULE_SEGMENT_ORDER` + `review` before `idle`: `needs-you, error, working, review, idle`. `classifyLocationLane(s)`: `gitWorktree ? "worktrees" : "main"`. *Alternative:* bespoke precedence (first draft, no `error`) — rejected after the mockup: it diverged from the capsule's `error` bucket.

### D3 — Hysteresis lives in a hook, not the classifier
`useLaneHysteresis(folderKey, rawAssignments)` keeps `Map<sessionId, {lane, heldUntil}>`. Demotion out of `working` is held ~3000 ms (one `setTimeout` per folder, re-armed to the earliest `heldUntil`, cleared on unmount); promotion to `needs-you` or `error` and any move out of them apply immediately. While held, the card renders its NEW status plus a countdown underline in the destination lane color (hook exposes `holding: {until, destLane}` per id). Classifier stays pure and trivially testable; the hook is tested with fake timers.
*Alternative:* debounce the whole folder render — rejected: delays `needs-you`, which must be instant.

### D4 — Drag-reorder: one SortableContext per lane, slot-preserving merge
Each lane renders its own `SortableContext`. On a within-lane drop the client computes the new lane order and merges it back into the folder's full stored order by **slot replacement**: the positions the lane's ids occupied in the stored order are refilled, in order, with the reordered ids; all other ids keep their positions. The merged array goes through the existing `onReorderSessions` path. Cross-lane drops are detected in `onDragEnd` (source lane ≠ target lane, neither is the ended bucket) and ignored → dnd-kit snaps back. Ended-bucket → lane drops keep the existing drag-to-resume path unchanged.
*Alternative:* one SortableContext across lanes + reject in handler — rejected: dnd-kit would visually shift cards across lanes mid-drag, implying the move is allowed.

### D5 — Movement animation: tiny hand-rolled FLIP, no dependency
A `useFlipOnLaneChange` hook records card `getBoundingClientRect()` per id before commit (`useLayoutEffect` snapshot keyed by lane-assignment fingerprint) and applies an inverted `transform` + 200 ms transition after. Skipped when `matchMedia('(prefers-reduced-motion: reduce)')` matches or when a drag is active. Selected-card scroll-into-view reuses the existing `selectedCardScrollFingerprint` mechanism by including the lane id in the fingerprint.
*Alternative:* add `framer-motion`/`auto-animate` — rejected per "minimize dependencies".

### D6 — Preferences shape and protocol
`preferences.json` fields (all optional): `defaultGroupBy`, `folderGroupBy: Record<pathKey, GroupByMode>`, `collapsedLanes: string[]` (`"<pathKey>::<laneId>"`). Shared type `GroupByMode = "none" | "status" | "location"`, `LaneId = "needs-you" | "error" | "working" | "review" | "idle" | "main" | "worktrees"`.
Browser→server (explicit target state, never toggles, `path` field like siblings):
- `set_folder_group_by { path, mode: GroupByMode | null }` (`null` = use default)
- `set_default_group_by { mode: GroupByMode }`
- `set_lane_collapsed { path, lane: LaneId, collapsed: boolean }`
Server→browser: one `group_by_prefs_updated { defaultGroupBy, folderGroupBy, collapsedLanes }`, sent in the connect burst immediately after `collapsed_folders_updated` (before `pinned_dirs_updated`/`workspaces_updated`) and on every real mutation. One aggregate message keeps client state atomic and the handler trivial; payload is tiny.
Server validates enums; invalid → drop, no write, no broadcast. Keys canonicalized with the same `inferPlatform` + `pathKey` path used for `collapsedFolders`. No orphan pruning.
*Alternative:* put grouping inside `displayPrefs` — rejected: `displayPrefs` is a flat UI-prefs bag without canonical-path keys; mixing keyed maps in muddles its merge semantics.

### D7 — Global default UI location
"Default grouping" select lives in the Settings panel alongside other sidebar/display preferences, and the folder menu's `Use default (<Mode>)` item names it — so the default is discoverable from where it takes effect.

### D8 — Urgency toggle retirement + one-shot migration
Remove the `urgency-sort` menu item and `floatAskUserFirst` usage from the render pipeline (the helper may be deleted if orphaned). Migration runs client-side once per browser after the first `group_by_prefs_updated` arrives: for each folder in the legacy localStorage set without an explicit `folderGroupBy` entry → send `set_folder_group_by {path, mode:"status"}`; then remove the localStorage key. Mirrors the collapse-state migration (only clear local state after the server snapshot is observed, so an interrupted connection retries next load).

### D10 — Visual language (from the approved mockup)
See `mockups/ui-plan.md` for the full surface → token → state table. Key calls:
- Lane glyph = card status shape (`statusShapeIcon`), rendered ON the lane's rail segment; rail tinted `color-mix(<lane color> 55%, transparent)`; location lanes neutral `--text-tertiary`.
- Lane label text never uses status color (amber on white fails contrast) — color only on glyph + rail.
- Mode chip lives on the folder header's path row (row 1 truncated the name at 360 px).
- New theme token `--status-unread` (dark `#22d3ee`, light `#0891b2`) replaces the hardcoded cyan in `.card-stripes-unread` and colours the `review` lane.
- Cross-lane drop: dashed `--status-error` outline + `dropEffect="none"` + explanatory toast; selected-card lane change → polite live-region announcement.
- Coarse pointer / ≤ 760 px: lane headers + menu items 44 px; chip keeps 18 px visual with 44 px hit area.

### D9 — Headers only when they help
Compute non-empty lanes; if ≤1, render the plain list with no lane chrome (same DOM as `none`, keeping existing tests/selectors stable). Search / tag-filter active → bypass lanes entirely and use the existing flat-merge / filtered path.

## Risks / Trade-offs

- [Cards still move in Status mode, harming spatial memory] → hysteresis (D3), FLIP (D5), keep-selected-in-view; `Location` offered as the calm alternative; default stays `none`.
- [Re-partition cost on every status tick with many sessions] → classification is O(n) per folder over already-filtered alive sessions; memoize on a fingerprint of `(id, lane-relevant fields)` so unrelated session updates (tokens, cost) don't re-partition.
- [Slot-preserving merge misorders when the stored order lacks some lane ids] → ids absent from stored order are appended to the merged array in lane order; covered by unit tests.
- [Nested dnd contexts regress folder-level drag] → lanes only nest session `SortableContext`s inside the folder item; folder drag handle untouched; existing drag tests must stay green.
- [Removing urgency toggle surprises users] → migration preserves intent (folder becomes `status`); noted as BREAKING (UI) in proposal/CHANGELOG.
- [Unread semantics make `review` lane flicker when viewing] → viewing a session is a deliberate action; moving to `idle` on read is expected; hysteresis not applied to `review → idle`.

## Migration Plan

1. Ship server prefs + protocol first-compatible: new fields optional, old clients ignore `group_by_prefs_updated`.
2. Client consumes prefs; default `none` ⇒ no visible change until the user opts in.
3. Legacy urgency toggle migrated client-side on first connect (D8).
4. **Rollback**: revert client+server; extra keys in `preferences.json` are ignored by the old loader (it only reads known fields and rewrites the file on next mutation, dropping them — acceptable, user re-picks modes). The localStorage urgency set is already cleared, so rolled-back users lose that toggle's state (low impact).
