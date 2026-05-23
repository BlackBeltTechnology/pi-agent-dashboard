## 1. Bridge: reset shadow queues + clear pi queues on shutdown

- [x] 1.1 In `packages/extension/src/bridge.ts`, locate the `shutdown` extension command. Restructure to run reset BEFORE `cachedCtx.shutdown()`:
  - Defensive pi calls: `try { if (typeof (pi as any).clearSteeringQueue === "function") (pi as any).clearSteeringQueue(); } catch {}` — same pattern for `clearFollowUpQueue`. Unconditional.
  - Conditional shadow reset: `if (bridgeSteering.length > 0 || bridgeFollowUp.length > 0) { bridgeSteering = []; bridgeFollowUp = []; emitQueueUpdate(); }`.
  - Then existing `cachedCtx.shutdown()` and `setTimeout(process.exit, 500)` — unchanged.
- [x] 1.2 Inline comment block referencing the spec requirement + session-change reset analog.

## 2. Tests

- [x] 2.1 Unit test in `packages/extension/src/__tests__/bridge-shutdown-reset.test.ts` — pure model mirror, 9 tests covering: non-empty steering, non-empty followUp, both, both empty (no emit), missing pi APIs, throwing pi.clear, order-of-operations, safety-net regression × 2.
- [x] 2.2 Order-of-operations test asserts `pi.clearSteeringQueue` → `pi.clearFollowUpQueue` → `emitQueueUpdate` → `cachedCtx.shutdown` → `setTimeout(process.exit)`.
- [x] 2.3 Regression guard: `cachedCtx.shutdown` still called + `process.exit` still scheduled when shadows empty AND when `cachedCtx` is null.

## 3. Documentation

- [x] 3.1 `docs/file-index-extension.md` row for `src/extension/bridge.ts` updated via subagent (caveman style) with reference to this change.

## 4. Verification (shutdown path)

- [x] 4.1 `npm test 2>&1 | tee /tmp/pi-test.log`. Result: 6080 pass / 2 fail. Both failures pre-exist on develop — AgentToolRenderer popout button + MinimalChatView container class — unrelated. New `bridge-shutdown-reset.test.ts` 9/9 pass.
- [x] 4.3 `openspec validate reset-shadow-queues-on-shutdown --strict` → ✓ valid.

## 6. Scope expansion (mid-implementation, user-driven)

User testing revealed the immediate need was the **abort** path (Stop button), not shutdown. Then a second round of user feedback expanded scope further to match pi-TUI's `restoreQueuedMessagesToEditor` behavior — clear + restore-to-editor — for full TUI parity.

- [x] 6.1 Bridge `abort` extension command (`packages/extension/src/bridge.ts`): symmetric reset to `shutdown` — defensive `pi.clearSteeringQueue`/`clearFollowUpQueue`, conditional shadow reset + `emitQueueUpdate`, THEN existing `cachedCtx.abort()` + `retryTracker.noteAbort` + `usageLimitOrderer.noteRetryEnd`.
- [x] 6.2 Client `wrappedHandleAbort` in `packages/client/src/App.tsx`:
  - Snapshot `sessions.get(selectedId)?.pendingQueues` BEFORE dispatching abort (bridge clears them immediately).
  - Merge: `[steering[], followUp[]].flat().filter(t => t.trim()).join("\n\n")` → `queuedText`.
  - If non-empty, set draft to `[queuedText, currentDraft].filter(t => t.trim()).join("\n\n")`.
  - Replace 2 existing `onAbort={handleAbort}` references with `onAbort={wrappedHandleAbort}`.
- [x] 6.3 Spec delta updated with 2 new requirements + 7 scenarios:
  - "User abort resets shadow queues and clears pi's native queues" (3 scenarios)
  - "Client restores aborted queue text into the command-input draft" (4 scenarios)
- [x] 6.4 Client rebuild (`npm run build`) + server restart + bridge reload to deploy.
- [x] 6.5 Manual smoke confirmed by user: Stop clears chips AND restores text to draft.

## 5. Archive

- [x] 5.1 Run `openspec archive reset-shadow-queues-on-shutdown` to fold the spec delta into `openspec/specs/mid-turn-prompt-queue/spec.md`.
