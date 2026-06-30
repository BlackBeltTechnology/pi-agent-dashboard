# Tasks — optimistic prompt feedback (idle-scoped, progressing)

## 1. Investigate the bridge ack feasibility (resolves design open questions)
- [ ] 1.1 Read `packages/extension/src/bridge.ts` `send_prompt` handling + the capture-before-send streaming gate; confirm where the idle/streaming verdict is known. → verify: cite the line that snapshots `isAgentStreaming` before `pi.sendUserMessage`.
- [ ] 1.2 Decide: emit a new `prompt_received { fresh: boolean }` ack, or reuse an existing signal. → verify: documented in `design.md` open-question 1 resolution.
- [ ] 1.3 If new message needed, add `prompt_received` to `src/shared/browser-protocol.ts` (bridge→server→browser) + server pass-through in `browser-gateway.ts`. → verify: `npm test` type-checks; protocol union compiles.

## 2. Extend `PendingPrompt` type + reducer
- [ ] 2.1 Add `status: "sending" | "sent"` to `PendingPrompt` (`packages/client/src/lib/event-reducer.ts:115`). → verify: `tsc` passes.
- [ ] 2.2 Reducer: on `prompt_received{fresh:true}` set `status:"sent"`; on `{fresh:false}` clear `pendingPrompt`. → verify: new reducer unit tests for both branches.
- [ ] 2.3 Confirm existing clears (user `message_start`, `agent_start`, abort, turn-end — 6 sites) still null `pendingPrompt`. → verify: existing reducer tests green.

## 3. Re-wire the write site, idle-scoped
- [ ] 3.1 `useSessionActions.handleSend` — set `pendingPrompt{status:"sending"}` only when not mid-turn at send time; keep `send({type:"send_prompt"...})`. → verify: unit test — idle send writes pendingPrompt; mid-turn send does not.
- [ ] 3.2 `useSessionActions.handleSendPromptToSession` (card/board quick-send) — same idle guard. → verify: unit test for quick-send path.
- [ ] 3.3 Remove the v2-era manual `pendingPrompt` clears on `clear_queue` / `remove_queue_entry` (no longer reachable with idle-scoping). → verify: those handlers no longer reference `pendingPrompt`; queue tests green.

## 4. Re-activate + restyle the optimistic bubble (progress states)
- [ ] 4.1 Re-activate the `ChatView.tsx:608` block; remove the `!(queuedTexts?.includes(...))` suppression guard and the `queuedTexts` plumbing where only used for suppression. → verify: render test — bubble shows for idle pendingPrompt.
- [ ] 4.2 Implement `sending` state: `opacity-60`, edge-pulse + sweep clipped to bubble (`overflow:hidden` on bubble, not pseudo-element), spinner + "sending". → verify: snapshot/render test asserts classes + clip.
- [ ] 4.3 Implement `sent` state: full opacity, green check, "sent", identical box geometry. → verify: render test asserts no geometry change between states.
- [ ] 4.4 Confirm `confirmed` transition (server `message_start` → reducer clear) introduces zero layout shift. → verify: test that server card and optimistic card share alignment/max-width/radius classes.

## 5. Input + safety timeout
- [ ] 5.1 Input disabled while `pendingPrompt` exists (idle-only now); re-enabled on any clear path. → verify: existing `optimistic-prompt` input tests adapted + green.
- [ ] 5.2 Confirm `usePendingPromptTimeout` still arms for idle pendingPrompt and clears after 30s. → verify: timeout test green.

## 6. Spec reconciliation + reset/replay
- [ ] 6.1 Confirm `useMessageHandler` carries `pendingPrompt` (incl. `status`) across `session_state_reset` + `event_replay` full-reset. → verify: existing carry tests adapted for `status` field.
- [ ] 6.2 Cancel paths (Stop button, Escape) clear `pendingPrompt` + abort. → verify: cancel tests green.

## 7. Mockup + docs
- [ ] 7.1 Mockup already at `openspec/changes/optimistic-prompt-progress/mockup/index.html` (current vs proposed + 3 frames; sweep clip fixed). → verify: serve + visual review.
- [ ] 7.2 Update `docs/file-index-client.md` rows for `ChatView.tsx`, `useSessionActions.ts`, `event-reducer.ts`, `usePendingPromptTimeout.ts` with `See change: optimistic-prompt-progress`. → verify: delegate doc write per AGENTS.md caveman rule.

## 8. Verification gate
- [ ] 8.1 `npm test` full suite green. → verify: `/tmp/pi-test.log` no FAIL.
- [ ] 8.2 `npm run quality:changed` clean. → verify: single exit 0.
- [ ] 8.3 Manual: send to an idle session → instant sending bubble → sent → confirmed, no gap, no flicker. Send mid-turn → queue chip only, no optimistic bubble. → verify: manual checklist.
