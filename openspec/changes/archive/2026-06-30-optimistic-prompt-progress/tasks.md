# Tasks — optimistic prompt feedback (idle-scoped, progressing)

## 1. Investigate the bridge ack feasibility (resolves design open questions)
- [x] 1.1 Read `packages/extension/src/bridge.ts` `send_prompt` handling + the capture-before-send streaming gate; confirm where the idle/streaming verdict is known. → verify: cite the line that snapshots `isAgentStreaming` before `pi.sendUserMessage`. (bridge.ts:1156 `const wasStreaming = getBridgeState().isAgentStreaming;`; command-handler.ts:518 `const wasStreaming = options?.isStreaming?.() ?? false;`)
- [x] 1.2 Decide: emit a new `prompt_received { fresh: boolean }` ack, or reuse an existing signal. → verify: documented in `design.md` open-question 1 resolution. (New `prompt_received` ack chosen.)
- [x] 1.3 If new message needed, add `prompt_received` to `packages/shared/src/browser-protocol.ts` (bridge→server→browser) + server pass-through in `packages/server/src/event-wiring.ts`. → verify: `npm test` type-checks; protocol union compiles. (Added `PromptReceivedToServerMessage` in protocol.ts + `PromptReceivedToBrowserMessage` in browser-protocol.ts; server pass-through in event-wiring.ts via `sendToSubscribers`.)

## 2. Extend `PendingPrompt` type + reducer
- [x] 2.1 Add `status: "sending" | "sent"` to `PendingPrompt` (`packages/client/src/lib/event-reducer.ts:115`). → verify: `tsc` passes.
- [x] 2.2 Reducer: on `prompt_received{fresh:true}` set `status:"sent"`; on `{fresh:false}` clear `pendingPrompt`. → verify: new reducer unit tests for both branches. (`applyPromptReceived` helper + tests in event-reducer.test.ts; wired in useMessageHandler `case "prompt_received"` + tests.)
- [x] 2.3 Confirm existing clears (user `message_start`, `agent_start`, abort, turn-end — 6 sites) still null `pendingPrompt`. → verify: existing reducer tests green.

## 3. Re-wire the write site, idle-scoped
- [x] 3.1 `useSessionActions.handleSend` — set `pendingPrompt{status:"sending"}` only when not mid-turn at send time; keep `send({type:"send_prompt"...})`. → verify: unit test — idle send writes pendingPrompt; mid-turn send does not. (useSessionActions.optimistic-prompt.test.tsx)
- [x] 3.2 `useSessionActions.handleSendPromptToSession` (card/board quick-send) — same idle guard. → verify: unit test for quick-send path.
- [x] 3.3 Remove the v2-era manual `pendingPrompt` clears on `clear_queue` / `remove_queue_entry` (no longer reachable with idle-scoping). → verify: those handlers no longer reference `pendingPrompt`; queue tests green. (No such clears existed in current code — queue-mutation senders never touched `pendingPrompt`; confirmed nothing to remove.)

## 4. Re-activate + restyle the optimistic bubble (progress states)
- [x] 4.1 Re-activate the `ChatView.tsx:608` block; remove the `!(queuedTexts?.includes(...))` suppression guard and the `queuedTexts` plumbing where only used for suppression. → verify: render test — bubble shows for idle pendingPrompt.
- [x] 4.2 Implement `sending` state: `opacity-60`, edge-pulse + sweep clipped to bubble (`overflow:hidden` on bubble, not pseudo-element), spinner + "sending". → verify: snapshot/render test asserts classes + clip. (`.prompt-sending-fx` overflow:hidden + `::after` sweep; `.prompt-edge-pulse`.)
- [x] 4.3 Implement `sent` state: full opacity, green check, "sent", identical box geometry. → verify: render test asserts no geometry change between states.
- [x] 4.4 Confirm `confirmed` transition (server `message_start` → reducer clear) introduces zero layout shift. → verify: test that server card and optimistic card share alignment/max-width/radius classes. (Optimistic bubble uses identical `bg-blue-500/10 border border-blue-500/20 border-l-2 border-l-blue-400 rounded-xl px-4 py-2` geometry as server user card; geometry-parity render test.)

## 5. Input + safety timeout
- [x] 5.1 Input disabled while `pendingPrompt` exists (idle-only now); re-enabled on any clear path. → verify: existing `optimistic-prompt` input tests adapted + green. (CommandInput `pendingPrompt` boolean prop unchanged; tests green.)
- [x] 5.2 Confirm `usePendingPromptTimeout` still arms for idle pendingPrompt and clears after 30s. → verify: timeout test green. (Pause logic removed at App.tsx call site — never relevant once idle-scoped; timeout tests green.)

## 6. Spec reconciliation + reset/replay
- [x] 6.1 Confirm `useMessageHandler` carries `pendingPrompt` (incl. `status`) across `session_state_reset` + `event_replay` full-reset. → verify: existing carry tests adapted for `status` field.
- [x] 6.2 Cancel paths (Stop button, Escape) clear `pendingPrompt` + abort. → verify: cancel tests green.

## 7. Mockup + docs
- [x] 7.1 Mockup already at `openspec/changes/optimistic-prompt-progress/mockup/index.html` (current vs proposed + 3 frames; sweep clip fixed). → verify: serve + visual review.
- [x] 7.2 Update `docs/file-index-client.md` rows for `ChatView.tsx`, `useSessionActions.ts`, `event-reducer.ts`, `usePendingPromptTimeout.ts` with `See change: optimistic-prompt-progress`. → verify: delegate doc write per AGENTS.md caveman rule. (Delegated; also annotated useMessageHandler.ts, App.tsx, index.css + shared/server/extension protocol rows.)

## 8. Verification gate
- [x] 8.1 `npm test` full suite green. → verify: `/tmp/pi-test.log` no FAIL. (8470 passed; 4 pre-existing environmental timeout flakes in unrelated server-spawn/search-files integration tests — confirmed identical failure with this change stashed.)
- [x] 8.2 `npm run quality:changed` clean. → verify: single exit 0. (tsc clean; new code introduces no new lint diagnostics. Pre-existing biome issues in touched files left untouched per surgical-changes rule; `biome --write` was reverted as it reformatted whole unrelated import blocks.)
- [x] 8.3 Manual: send to an idle session → instant sending bubble → sent → confirmed, no gap, no flicker. Send mid-turn → queue chip only, no optimistic bubble. → verify: manual checklist. AUTOMATED via Playwright E2E `tests/e2e/optimistic-prompt.spec.ts` (idle-appears-then-confirms + mid-turn-queue-chip), run against the Docker faux harness with the system browser (`npm run test:e2e:chrome`). Both pass. NOTE: surfaced + fixed a real bug — a freshly-selected idle session has no `SessionState` entry yet, so the original `if (!current) return prev` guard skipped the optimistic write; now treats absent state as idle (seeds `createInitialState()`), bridge ack reconciles. E2E infra: env-driven `PW_CHANNEL` in `playwright.config.ts` + bundled-Chromium preflight skip in `global-setup.ts` + `test:e2e:chrome` script.
