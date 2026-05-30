# Tasks

## 0. Resolve open threads (blocks 1+)

- [x] Spike Q1: abort a long bash via the existing channel, observe child PGID lifecycle. Record finding in design.md. (Inconclusive — no live session in implementation context. Documented as known issue per proposal; Phase 2 closes.)
- [x] Audit Q2: grep `packages/shared/src/browser-protocol.ts` for per-toolCall abort. Pick path (a/b/c) and update proposal.md scope if (c). (Path **b**: session-level abort only. Activity bar `[⏹]` falls back to `handleAbort()`.)
- [x] Trace Q3: sample `~/.pi/dashboard/sessions/*.jsonl` for concurrent-bash counts. Set the N=2 vs N=3 visible cap. (No traces available; N=2 kept per Decision 6.)

## 1. Session-activity-bar capability (NEW)

- [x] 1.1 Add `useInflightBashTools(sessionId)` selector — reads event-reducer state, returns `Array<{ toolCallId, command, startedAt }>` for unresolved `bash` toolCalls. (`packages/client/src/hooks/useInflightBashTools.ts`; also extends `ToolCallState` with `startedAt`.)
- [x] 1.2 Write tests for `useInflightBashTools`: empty, one running, multiple running, one running + one resolved (only running surfaces). (`packages/client/src/hooks/__tests__/useInflightBashTools.test.ts`.)
- [x] 1.3 Implement `SessionActivityBar.tsx` — pure component. (`packages/client/src/components/SessionActivityBar.tsx`. MAX_VISIBLE=2 per Decision 6.)
- [x] 1.4 Component tests. (`packages/client/src/components/__tests__/SessionActivityBar.test.tsx`.)
- [x] 1.5 Wire `onAbort` to the abort message picked in 0.Q2. (`App.handleAbortTool` → `send({ type: "abort", sessionId })`; toolCallId kept for forward-compat.)

## 2. Background processes drawer (MODIFIED from ProcessList)

- [x] 2.1 Docstring documenting the new role.
- [x] 2.2 Remove `MIN_SLOTS` skeleton padding; `computeVisibleRows` no longer returns `skeletonCount`.
- [x] 2.3 `expanded` + `onToggle` controlled props added.
- [x] 2.4 Summary row renders `⚠ N background process(es)` and is the toggle target.
- [x] 2.5 Collapsed renders only the summary; expanded renders rows.
- [x] 2.6 Tests updated (`ProcessList.test.tsx`).

## 3. SessionCard PROCESS subcard composition

- [x] 3.1 `ProcessSubcard` component stacks activity bar above drawer.
- [x] 3.2 Subcard returns `null` when both surfaces are empty.
- [x] 3.3 `useDrawerExpansion` hook implements contextual default + per-session override.
- [x] 3.4 Four-state matrix tests added in `SessionCard.test.tsx`.

## 4. Mobile compact layout

- [x] 4.1 SessionActivityBar accepts `compact` prop — full-width rows, no header.
- [x] 4.2 `MobileProcessSubcard` renders `⚠ N` chip when drawer non-empty.
- [x] 4.3 Chip tap opens a bottom-sheet overlay with expanded ProcessList.
- [x] 4.4 Mobile tests added in `SessionCard.test.tsx`.

## 5. Tooltips & accessibility

- [x] 5.1 `STOP_TOOLTIP` constant in SessionActivityBar.
- [x] 5.2 `KILL_TOOLTIP` constant in ProcessList.
- [x] 5.3 Container has `role="status"` + `aria-live="polite"`.
- [x] 5.4 Summary row is `<button>` with `aria-expanded`.

## 6. Documentation

- [x] 6.1 `docs/file-index-client.md`: added rows for `ProcessList.tsx` (new packages path), `SessionActivityBar.tsx`, `useInflightBashTools.ts`; appended PROCESS-subcard composition note to existing `SessionCard.tsx` row. Caveman style.
- [x] 6.2 `docs/architecture.md` had no PROCESS-subcard mention — no update required.
- [x] 6.3 Phase 2 follow-up section added to `proposal.md` documenting PGID-on-toolCall + per-toolCall abort message.

## 7. Verification

- [x] 7.1 `npm test` — all unit tests pass. (6605/6605 passing, 19 skipped; +8 new tests added by this change.)
- [ ] 7.2 Manual: open a session, run `npm test` via agent → activity bar appears, stop → bash aborts cleanly, no orphan in drawer (if Q1 resolved positively). (Deferred: requires live pi session — user verification step.)
- [ ] 7.3 Manual: leave a `vitest --watch` running, no active agent tool → subcard shows only the drawer, drawer is OPEN. (Deferred: user verification step.)
- [ ] 7.4 Manual: run `npm test` + have an orphan `vitest --watch` → activity bar + drawer (collapsed) both show. (Deferred: user verification step.)
- [x] 7.5 `openspec validate redesign-process-list-activity-bar --strict` passes.
