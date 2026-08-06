## 1. Shared protocol

- [x] 1.1 Add `NotifyMessage` to `packages/shared/src/protocol.ts` (`type:"notify"`, `sessionId`, `notifyId`, `message`, `level?: "info"|"success"|"warning"|"error"`) and add it to the union at ~line 598. No `promptId`, no `component`, no `placement`
- [x] 1.2 Add `BrowserNotifyMessage` to `packages/shared/src/browser-protocol.ts` and add it to the union at ~line 863
- [x] 1.3 Confirm `PromptRequestMessage` / `BrowserPromptRequestMessage` are byte-identical to before
- [x] 1.4 Test: `"notify"` is a statically known discriminant and the send site needs no `as any` — see `packages/shared/src/__tests__/browser-protocol-types.test.ts`. Triple: union member `"notify"` · consumer switches on `type` · compiles without cast (test-plan #E10)

## 2. Server guard for the legacy shape (fixes already-deployed bridges first)

- [x] 2.1 In `packages/server/src/event-wiring.ts` `prompt_request` branch (~1556), add the legacy notify early-out after the `owner`/`ended` guard and before `trackPromptRequest`; normalize via `fromLegacyPromptRequest(msg)` then `handleNotify(...)` and return
- [x] 2.2 `fromLegacyPromptRequest` reads `message` and `level` from `component.props.*` and maps an unrecognized `level` to `"info"` — an already-published bridge sends it unvalidated and the new bridge's send-site normalization cannot retro-fix it
- [x] 2.3 Test: legacy notify does not create a pending prompt and is delivered normalized — see `packages/server/src/__tests__/prompt-derived-tool-state.integration.test.ts`. Triple: old-bridge `prompt_request{prompt.type:"notify"}` · server guard runs · subscribers receive a `notify`, never the raw frame; registry untouched (test-plan #X9)
- [x] 2.4 Test: legacy unrecognized level normalized — see same file. Triple: `component.props.level:"debug"` · guard normalizes · delivered notify carries `level:"info"` (test-plan #E5)
- [x] 2.5 Test: no re-arm after a turn, legacy shape — see same file. Triple: session received legacy notify · `tool_execution_start{bash}` → `tool_execution_end` · `currentTool === null`, not `"ask_user"` (test-plan #X4). MUST fail before 2.1
- [ ] 2.6 Restart the server (`curl -X POST http://localhost:8000/api/restart`) and confirm a freshly spawned session no longer reads "Needs you" at rest

## 3. Server notify log (durability — Contract 2)

- [x] 3.1 Add a bounded per-session notify log to `packages/server/src/pairing/browser-gateway.ts`: cap 50 entries, oldest-first eviction. It MUST NOT feed `hasPendingPromptRequests`, the embed-lifecycle `hasPendingAsk` union, or the `currentTool` derivation
- [x] 3.2 Do NOT clear the log in `clearPendingRequestsForSession` / `onUnregister` — an ended session keeps its rows; reapability is protected by exclusion (3.1), not deletion
- [x] 3.3 Persist the log alongside the session record so it survives a server restart, matching the rest of the transcript
- [x] 3.4 Add `replayNotifyLog(ws, sessionId)` as a sibling of `replayPendingUiRequests` and call it at all four sites in `packages/server/src/pairing/browser-handlers/subscription-handler.ts` (~222 stale-lastSeq, ~245 delta with events, ~250 delta without events, ~301 cold hydration). Do NOT fold it into `replayPendingUiRequests`
- [x] 3.5 Test: log holds exactly the cap — see `prompt-derived-tool-state.integration.test.ts`. Triple: 49 logged · 50th arrives · length 50, zero evictions (test-plan #E6)
- [x] 3.6 Test: eviction past the cap. Triple: 50 logged · 51st arrives · length 50, entry #1 evicted, #51 present (test-plan #E7)
- [x] 3.7 Test: empty-log replay is a no-op. Triple: 0 notifies · browser subscribes · `replayNotifyLog` sends nothing, no error (test-plan #E8)
- [x] 3.8 Test: retained log on a dead session is still reapable. Triple: ended session, non-empty log · reaper evaluates · `hasPendingAsk` false, session eligible (test-plan #X7)
- [x] 3.9 Test: bounded under a chatty emitter. Triple: 10 000 notifies to one session · log length ≤ 50 · single run (test-plan #P1)

## 4. Server routing for the new message type

- [x] 4.1 Add a `msg.type === "notify"` branch in `event-wiring.ts`: ownership guard (drop unknown/`ended`), append to the notify log, `sendToSubscribers` — no `trackPromptRequest`, no `currentTool` write, no unread stamp, no `questionFirst` reorder, no `session_updated` broadcast
- [x] 4.2 Test: no re-arm after a turn, new shape — see `prompt-derived-tool-state.integration.test.ts`. Triple: session received a `notify` · `tool_execution_start{bash}` → `tool_execution_end` · `currentTool === null` (test-plan #X3). MUST fail before 4.1
- [x] 4.3 Test: notify raises no pending ask. Triple: notify-only session · reaper quiescence gate evaluated · `hasPendingPromptRequests` false, `hasPendingAsk` false, reapable (test-plan #X6)
- [x] 4.4 Test: notify does not mark unread or reorder. Triple: live session no browser viewing · `notify` arrives · not unread, no `questionFirst` reorder, no `session_updated` broadcast (test-plan #X8)
- [x] 4.5 Test: notify for an unknown session is dropped. Triple: `notify` for an unowned id · server dispatch · no delivery, no log entry, no state write (test-plan #X1)
- [x] 4.6 Test: notify for an ended session is dropped. Triple: `notify` for status `ended` · server dispatch · same as #X1 (test-plan #X2)
- [x] 4.7 Test (pinned negative): genuine `prompt_request` unaffected. Triple: `prompt_request{prompt.type:"select"}` · server branch runs · tracked + folded + unread-stamped + reordered exactly as before (test-plan #E11)
- [x] 4.8 Test (pinned negative): genuine prompt still re-arms. Triple: genuine pending prompt · `tool_execution_end` · `currentTool === "ask_user"` (test-plan #X5)

## 5. Bridge emits on the notify channel

- [x] 5.1 In `packages/extension/src/bridge.ts` (~2317), change the `ctx.ui.notify` proxy to send `{type:"notify", sessionId, notifyId: crypto.randomUUID(), message, level}`; drop the `as any` cast now that 1.1 types it
- [x] 5.2 Normalize an unrecognized `level` to `"info"` at the send site
- [x] 5.3 Test: proxy emits the notify frame — see `packages/extension/src/__tests__/prompt-bus-wiring.test.ts`. Triple: `ctx.ui.notify("hello","info")` · proxy runs · frame is `{type:"notify",...}` with no `promptId`/`placement`/`component`; original notify still called; no `prompt_request` sent (test-plan #E1)
- [x] 5.4 Test: level omitted when absent. Triple: `ctx.ui.notify("hi")` · proxy runs · frame omits `level` (test-plan #E2)
- [x] 5.5 Test: success level survives. Triple: `ctx.ui.notify("done","success")` · proxy runs · frame carries `level:"success"` (test-plan #E3)
- [x] 5.6 Test: unrecognized level normalized at send site. Triple: `ctx.ui.notify("x","debug")` · proxy runs · frame carries `level:"info"` (test-plan #E4)
- [x] 5.7 Test: notify never enters PromptBus. Triple: `ctx.ui.notify(...)` · proxy runs · `getPendingRequests()` gains no entry and the reconnect resend omits it (test-plan #E12)
- [ ] 5.8 `npm run reload` and confirm a live notify still renders

## 6. Client render-only path

- [x] 6.1 Add a notify reducer to `packages/client/src/lib/chat/event-reducer.ts` that appends ONLY an `interactiveUi` row to `messages` (id `ui-<notifyId>`, `params` carrying `message`/`level` for `NotifyRenderer`). It MUST NOT add an `interactiveRequests` entry and MUST NOT route through `addInteractiveRequest`
- [x] 6.2 Dedup by `notifyId` (skip when a row with that id exists), never by message text — this replaces the `requestId` dedup that made replay idempotent, and 3.4 replays at both delta sites
- [x] 6.3 Handle `case "notify"` in BOTH reducers — `packages/client/src/hooks/useMessageHandler.ts` (main app) and `packages/client/src/hooks/useSessionState.ts` (embed). They are separate switches with separate call sites
- [x] 6.4 Keep `["notify", NotifyRenderer]` in `packages/client/src/components/interactive-renderers/registry.ts` — the renderer is still reached through the registry from the `interactiveUi` row
- [x] 6.5 Test: chat row added, no pending request (main-app reducer) — see `packages/client/src/__tests__/use-message-handler-pending-prompt.test.ts`. Triple: `notify` message · main-app reducer handles it · `messages` gains one `interactiveUi` row keyed `ui-<notifyId>`, `interactiveRequests` length 0 (test-plan #F1)
- [x] 6.6 Test: same invariant in the embed reducer — see same exemplar. Triple: same `notify` · embed session-state reducer · row added, `interactiveRequests` empty (test-plan #F2)
- [x] 6.7 Test: dedup by notifyId not text. Triple: two notifies, identical `message`, distinct `notifyId` · both delivered · two rows render (test-plan #E9)

## 7. Browser-level behaviour (L3, docker harness)

- [x] 7.1 E2E: transcript position preserved — see `tests/e2e/chat-transcript-virtualization.spec.ts` for transcript harness glue; read the port from `.pi-test-harness.json#dashboardPort`, never `:18000`. Triple: assistant msg → notify → assistant msg · transcript renders · notify row sits between them (test-plan #F3)
- [x] 7.2 E2E: notify survives a browser refresh — see `tests/e2e/error-lifecycle.spec.ts` for reload/state-convergence glue. Triple: session has 1 delivered notify · browser reloads and re-subscribes · row present after reload (test-plan #F4)
- [x] 7.3 E2E: warm reconnect does not duplicate — see same exemplar. Triple: notify delivered live · socket drop → delta re-subscribe → `replayNotifyLog` fires · exactly one row for that `notifyId` (test-plan #F5)
- [x] 7.4 E2E: ended session keeps its rows — see `tests/e2e/error-lifecycle.spec.ts`. Triple: session with notifies unregistered · browser opens the ended session · rows still render (test-plan #F6)
- [x] 7.5 E2E: no "Needs you" on a notify-only session — see `tests/e2e/faux-ask.spec.ts` for the ask_user card-state harness. Triple: freshly spawned session, ≥1 notify, no genuine prompt · card renders at rest · reads "Idle", no needs-you dot/rail/stripes, folder pill count unchanged (test-plan #F8)
- [x] 7.6 E2E (pinned negative): genuine `ask_user` still shows "Needs you" — see same exemplar. Triple: session issues a real `ask_user` · card renders · reads "Needs you" with needs-you styling (test-plan #F9)
- [x] 7.7 Smoke: notify log survives a server restart — see `qa/tests/02-server-start.sh`. Triple: session with delivered notifies · `POST /api/restart`, re-open session · notifications still delivered, transcript matches pre-restart (test-plan #F7)

## 8. Manual verification (deferred post-merge)

- [ ] 8.1 Compare the rendered notify row against the pre-change render for each level (info/success/warning/error) — colour, spacing, markdown identical (test-plan: manual-only)
- [ ] 8.2 Confirm the accepted old-server + new-bridge regression: pair a new bridge with a pre-change server, verify no crash and the notification is simply absent, per design Decision 9 (test-plan: manual-only)

## 9. Cleanup and verification

- [x] 9.1 Simplify `NotifyRenderer`'s `_promptBusComponent.props.*` read now that notify no longer rides the prompt envelope — keep the `params.message` / `params.level` path
- [x] 9.2 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep for failures
- [x] 9.3 `npm run quality:changed`
- [x] 9.4 Update the directory `AGENTS.md` rows for every touched file (`packages/shared/src/`, `packages/extension/src/bridge.ts.AGENTS.md`, `packages/server/src/event-wiring.ts.AGENTS.md`, `packages/server/src/pairing/`, `packages/client/src/hooks/`, `packages/client/src/lib/chat/`, `packages/client/src/components/interactive-renderers/`) with `See change: split-notify-from-prompt-request`

## 10. Discipline checkpoints

- [x] 10.1 Run `review-code` on the full diff before commit
- [x] 10.2 Run `observability-instrumentation` on the notify log — it is a new bounded, persisted, per-session store with an eviction path
