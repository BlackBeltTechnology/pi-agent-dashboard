## Why

Four small client-side UI defects from the issue backlog. Verified against current code (issue text is evidence, not fact).

- [#1135](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1135) — a failed session's card shows an error shape but an `Idle` label. **PARTIAL.** The issue's chain is wrong: `agent_end` setting `status = "ended"` is the chat reducer's own `SessionState.status` (`packages/client/src/lib/chat/event-reducer.ts:1888`), not `DashboardSession.status`. The server maps `agent_end` → `status: "idle"` (`packages/server/src/session/event-status-extraction.ts:98-99`) and `"ended"` means process gone (`memory-session-manager.ts:536`). So `classifyStatusLane` (`session-lanes.ts:38`) already files a live errored session under `error` via `deriveStatusShape` (`session-status-visuals.ts:149`), as `session-list-group-by` already requires. The real gap: `activityContent` (`SessionCard.tsx:110-167`) has no error branch, so the card prints `Idle` (`:162-165`) next to the error shape (`SessionCard.tsx:1018`). Two production render paths: the desktop status row calls `activityContent` directly (`:1498`) and the mobile card's line 2 goes through the `ActivityIndicator` wrapper (`:174-175,1246`); both need `hasError`.
- [#1154](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1154) — token in/out arrows are inverted relative to the rest of the UI. **PARTIAL / ambiguous.** No network-traffic indicator exists in the header. The only in/out arrow indicators are token counters, and they disagree: `↓in ↑out` in `TokenStatsBar.tsx:40-44,105-106` (and unused-looking `SessionSidebar.tsx:109-110`) vs `in↑ out↓` / `↑in ↓out` in `SessionCard.tsx:474`, `OpenSpecBoardView.tsx:1386`, `MinimalChatView.tsx:405`, `FlowAgentCard.tsx:106` (+ flow specs). The owner chose the `TokenStatsBar` convention (`↓ in`, `↑ out`) as canonical, so the four other components and their specs migrate to it. See design D1 (confirmed, owner, 2026-11-20).
- [#1155](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1155) — Automations overlay opens blank. **PARTIAL, not reproduced.** A mounted `AutomationBoard` always renders a visible header or message (full chrome at `AutomationBoard.tsx:257-278`; the `invalidRoute` branch at `:238-253` renders a reduced board with a message), so a blank panel means the board never mounted (or the claim has no `Component`, `slot-consumers.tsx:105`): the lazy `module` claim (`package.json` claims, `lazy-claim.tsx:22-42`) failed or is still loading, and `SlotErrorBoundary` renders `null` on error (`slot-error-boundary.tsx:36-38`) while the Suspense fallback is `ContentClaimSkeleton` (`slot-consumers.tsx:1327-1334`, a top-bar-shaped placeholder with `data-testid="content-claim-loading"`). Separately CONFIRMED: `listAutomations`/`listRuns` swallow every failure into `[]` (`api.ts:73-88`), so a 403/503 from `/list` (cwd admission, `routes.ts` `admitRouteCwdParam`) shows "No automations in this folder" — a failed fetch is indistinguishable from empty; there is no loading or error state (`AutomationBoard.tsx:127-150,300-318`). The watcher-miss hypothesis is UNVERIFIED and out of scope (`/list` scans on request, `routes.ts:291`).
- [#1156](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1156) — server chip "still wrong". **PARTIAL.** Placement is already fixed by archived `2026-11-03-fix-chat-transcript-layout`: the tray portals into the in-column `composer-stack-anchor` slot (`App.tsx:2728-2738`, `CanvasDriver.tsx:123-130`), outside the transcript scroll area. Still CONFIRMED: the tray is right-aligned (`items-end`, `CanvasDriver.tsx:126`) inside the `mx-5` column, so it reads as floating; the label is the raw page title with no width cap (`CanvasServerChip.tsx:32,53`); the full title is never recoverable because `title=` is a fixed hint (`:50`); the address is a bare `:port` (`:33`).

## What Changes

- Session card activity slot (desktop status row and mobile line 2) shows a `Failed` label with the error glyph instead of `Idle` when the session is idle/active with an error (new `hasError` argument to `activityContent` and the `ActivityIndicator` wrapper).
- Token in/out arrows unified to `↓ input` / `↑ output` everywhere (design D1, confirmed): `TokenStatsBar` + `SessionSidebar` already match; `SessionCard` (`TokenStats`), `OpenSpecBoardView`, `MinimalChatView`, `FlowAgentCard` flip.
- `AutomationBoard` gets explicit loading, error + Retry states; `api.ts` gains a result-returning fetch so failure is distinguishable from empty. The shell overlay-route renderer shows a visible error (with Back) instead of `null` when a claim has no component, fails to load or throws (`renderClaim` gains an optional `errorFallback`); the loading state keeps the existing skeleton.
- `CanvasServerChip` caps the label width, exposes full title + address in a tooltip/`aria-label`, shows `127.0.0.1:<port><path>` as secondary text; the in-column tray left-aligns to the dock inset (fixed-overlay fallback stays bottom-right).

## Capabilities

### New Capabilities
- none

### Modified Capabilities
- `session-card-status` — ADDED: activity indicator names a failed run
- `session-card-header` — MODIFIED: status-row activity label list gains `Failed`
- `ask-user-card-indicator` — MODIFIED: "Idle" label scoped to sessions without an error
- `flow-agent-card`, `flow-agent-detail`, `flow-card-grid`, `shared-timeline-view`, `openspec-card-section` — MODIFIED: token arrows `↓in ↑out` (the `token-stats-bar` spec already states this; unchanged)
- `shell-overlay-route` — ADDED: a failed or loading claim is never a blank overlay
- `automation-content-view` — ADDED: board loading / error / retry state
- `auto-canvas` — ADDED: server chip label cap, non-shrinking address + in-column alignment

## Non-goals

- No lane change for ended (process-gone) sessions with a stale `lastError` — see DECISIONS (D-1135).
- No change to the reducer's transient `status = "ended"` or server status mapping.
- No watcher/server changes for #1155; #1104 (unadmitted `payload.cwd`) is separate.
- No change to the mobile `canvas-file-chip` copy; no chunk-load auto-retry.
- No change to `TokenStatsBar`/`SessionSidebar` arrows or the `token-stats-bar` spec (already `↓in ↑out`); cache-read stays added to the input counter.

## Relationship

- Archived `2026-11-03-fix-chat-transcript-layout` (slot placement, `auto-canvas` "chip tray sits in the chat column") — kept; this change only adds label/alignment rules and does not touch the slot. `2026-10-12-fix-canvas-chip-tray-overlay`, `2026-07-15-auto-canvas` superseded on placement already.
- Archived `2026-07-13-simplify-error-retry-single-card`, `2026-08-12-raw-error-render-and-retry-authority` — error surfaces; this adds only the card label. Retry label keeps precedence (`session-card-status` retry requirement).
- Archived `2026-11-06-polish-automation-board` (board) — no overlap on loading/error.
- Active changes: none overlap (`ls openspec/changes`, grep of proposals).

## Discipline Skills

- `review-code` — non-trivial client changes before commit.
- `systematic-debugging` — #1155 is not reproduced; confirm the blank-overlay cause (lazy chunk failure vs fetch) before locking the fix.
- No security/perf/observability skills apply (no auth, untrusted input beyond existing escaping, endpoints or budgets).

## Impact

- Client: `packages/client/src/components/session/SessionCard.tsx`, `components/openspec/OpenSpecBoardView.tsx`, `components/canvas/CanvasServerChip.tsx`, `components/canvas/CanvasDriver.tsx`; `packages/automation-plugin/src/client/{AutomationBoard.tsx,api.ts}`; `packages/dashboard-plugin-runtime/src/{slot-consumers.tsx,slot-error-boundary.tsx}`; `packages/client-utils/src/minimal-chat/MinimalChatView.tsx`; `packages/flows-plugin/src/client/FlowAgentCard.tsx`; i18n catalogs for new keys.
- Backend: none. Compatibility: arrow flip is a visible, purely presentational change (no data/protocol impact); additive props/keys; `listAutomations` unchanged for existing callers. Rollback: revert the commit; no data/migration. Sections 1–4 of `tasks.md` are independent, so any one (notably the section-2 arrow flip, the only cross-plugin visible change) can be reverted alone.
