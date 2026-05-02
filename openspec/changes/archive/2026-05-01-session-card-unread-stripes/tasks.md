# Tasks — session-card-unread-stripes

## 1. Shared types & protocol

- [x] 1.1 Add `unread?: boolean` to `DashboardSession` in `packages/shared/src/types.ts` with JSDoc: "server-managed; bridges SHALL NOT send it; persisted to .meta.json."
- [x] 1.2 Add `unread?: boolean` to `SessionMeta` in `packages/shared/src/session-meta.ts`.
- [x] 1.3 Add `{ type: "session_view", sessionId: string }` and `{ type: "session_unview", sessionId: string }` to the `BrowserToServerMessage` union in `packages/shared/src/browser-protocol.ts`. **Critical**: must be in the union, not `as any`, or esbuild strips the switch cases in production.
- [x] 1.4 Update AGENTS.md entries for `src/shared/types.ts`, `src/shared/session-meta.ts`, `src/shared/browser-protocol.ts` to mention the new field/messages.

## 2. Unread-trigger classifier

- [x] 2.1 Add pure helper `isUnreadTrigger(args)` in `packages/server/src/event-status-extraction.ts`. Signature roughly `(eventType: string, before: Pick<Session, "status" | "currentTool">, after: Pick<Session, "status" | "currentTool">, payload?: unknown): boolean`. Triggers per design.md: streaming→idle/active, currentTool→ask_user, agent_end with error.
- [x] 2.2 Add unit test `packages/server/src/__tests__/is-unread-trigger.test.ts` covering each trigger (true), each non-trigger (false: streaming→streaming, idle→idle, message_end, tool_execution_*, model_select), and the agent_end-without-error case (false).

## 3. Viewed-session tracker

- [x] 3.1 Create `packages/server/src/viewed-session-tracker.ts` exposing a small interface: `view(sessionId, ws)`, `unview(sessionId, ws)`, `unviewAll(ws)`, `isViewedByAnyone(sessionId): boolean`. Internal storage `Map<sessionId, Set<ws>>`.
- [x] 3.2 Wire it into `browser-gateway.ts`: handle the new `session_view` / `session_unview` messages by calling `view` / `unview`. On WS close, call `unviewAll(ws)`.
- [x] 3.3 Pass the tracker into `event-wiring.ts` via the existing context object.
- [x] 3.4 Unit test `packages/server/src/__tests__/viewed-session-tracker.test.ts` covering: empty → false; one viewer → true; two viewers, one disconnects → still true; both disconnect → false; `unviewAll` removes from every set.

## 4. Server state machine — set unread

- [x] 4.1 In `packages/server/src/event-wiring.ts`, after the existing `extractSessionUpdates` call (around the same spot the last-activity stamping lives), evaluate `isUnreadTrigger(...)`. If true AND `viewedSessionTracker.isViewedByAnyone(sessionId) === false` AND `!replayingSessions.has(sessionId)`, set `session.unread = true` via `sessionManager.update(sessionId, { unread: true })` (which triggers the existing onChange → meta-write → broadcast).
- [x] 4.2 Add test `packages/server/src/__tests__/unread-trigger-wiring.test.ts` covering: trigger + not viewed → unread=true broadcast; trigger + viewed → unread stays false; trigger during replay → unread stays false.

## 5. Server state machine — clear unread on view

- [x] 5.1 In the `session_view` handler (browser-gateway.ts step 3.2), after calling `tracker.view(...)`, look up the session: if `session.unread === true`, call `sessionManager.update(sessionId, { unread: false })`. The existing onChange path persists and broadcasts.
- [x] 5.2 Test in the same file: `session_view` for an unread session → broadcast with unread=false; `session_view` for a session already read → no-op (no spurious broadcast).

## 6. Persistence

- [x] 6.1 In `packages/server/src/server.ts` (around line 289), include `unread: session.unread` in the `metaPersistence.save(...)` payload.
- [x] 6.2 In `packages/server/src/session-scanner.ts:67`, propagate `unread` from `meta` into the restored `DashboardSession` (alongside the other restored fields).
- [x] 6.3 Verify the cold-start "force status=ended" block in `server.ts:273-279` does NOT clobber `unread`. It only mutates `status` and `endedAt`, so we expect this to already work — add an assertion in a new integration test.
- [x] 6.4 Test `packages/server/src/__tests__/unread-persistence.test.ts`: save session with unread=true → reload from .meta.json → unread is true on restore.

## 7. Client view dispatcher

- [x] 7.1 Add pure helper `selectViewedSessionId(routeMatch): string | null` in `packages/client/src/lib/`. Probably `selectViewedSessionId.ts`. Returns the matched session id from `/session/:id` routes, null otherwise.
- [x] 7.2 Add `useViewDispatcher` hook in `packages/client/src/hooks/` that:
  - reads the current viewed session id via `selectViewedSessionId`
  - on each render where the value changed, sends `session_unview { previous }` then `session_view { current }` if non-null
  - on WS reconnect (subscribe to a reconnect signal exposed by the existing message-handler hook), re-sends `session_view { current }` for the current id
- [x] 7.3 Mount the hook in `App.tsx`.
- [x] 7.4 Test `packages/client/src/lib/__tests__/selectViewedSessionId.test.ts`.
- [x] 7.5 Test `packages/client/src/hooks/__tests__/useViewDispatcher.test.tsx` with a fake WS sender, asserting the correct sequence of messages on navigation and on reconnect.

## 8. CSS — gray stripes class

- [x] 8.1 Add `.card-unread-pulse` to `packages/client/src/index.css` mirroring `.card-working-pulse` exactly: same `@keyframes` references (`card-working-stripes-scroll`, `card-working-opacity-pulse`), same `background-size: 28.2843px 28.2843px, auto`, same animations, but background-image gradients use neutral gray (`rgba(156, 163, 175, 0.12)` for stripes, `rgba(156, 163, 175, 0.06)` for the flat tint).
- [x] 8.2 Add `.card-unread-pulse { animation: none; }` inside the existing `@media (prefers-reduced-motion: reduce)` block.

## 9. SessionCard precedence

- [x] 9.1 In `packages/client/src/components/SessionCard.tsx:55-59`, modify `getCardPulseClass(session)` to return `"card-unread-pulse"` when `session.unread === true` and no higher-priority class applies. Order: ask_user → streaming/resuming → unread → none.
- [x] 9.2 Update tests in `packages/client/src/components/__tests__/SessionCard.test.tsx`:
  - unread session → has `card-unread-pulse` class
  - streaming AND unread → has `card-working-pulse` (yellow wins)
  - ask_user AND unread → has `card-input-pulse` (purple wins)
  - read session, alive, no tool → no pulse class
  - ended session, unread=true → still has `card-unread-pulse` (per design.md edge case)

## 10. Documentation

- [x] 10.1 Update AGENTS.md key-files list with the new files: `viewed-session-tracker.ts`, `selectViewedSessionId.ts`, `useViewDispatcher.ts`. Update the existing entries for `event-wiring.ts`, `event-status-extraction.ts`, `SessionCard.tsx`, `index.css`-related entry if any, `session-scanner.ts`, `server.ts`.
- [x] 10.2 Update `docs/architecture.md` with the unread state machine + the `session_view` / `session_unview` protocol additions.
- [x] 10.3 Update `openspec/specs/session-card-status/spec.md` (handled automatically by `openspec change archive` from the spec delta in `specs/session-card-status/spec.md`).

## 11. Validation

- [x] 11.1 `npm test` passes locally.
- [x] 11.2 `openspec validate session-card-unread-stripes --strict` passes.
- [x] 11.3 Manual smoke: open two browsers on the same dashboard. View session A in browser 1, leave browser 2 on the sidebar. Send a prompt to session B from browser 1 and let the agent finish — both browsers should see B's card grow gray stripes. Click B in browser 2 → both browsers should see the stripes clear. *(Requires user verification — automated tests cover the same shape end-to-end via `unread-trigger-wiring.test.ts`, but cross-browser visual confirmation is left to a real session.)*
