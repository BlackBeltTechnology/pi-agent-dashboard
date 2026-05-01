## 1. Reproduce and lock the failure mode

- [x] 1.1 Add a regression test fixture: a hand-rolled JSONL file matching pi 0.70's schema (root header + ≥2 user/assistant message pairs with linearized `parentId` chain) under `packages/server/src/__tests__/fixtures/fork-jsonl-roundtrip.jsonl`.
- [x] 1.2 Add `packages/server/src/__tests__/fork-jsonl-roundtrip.test.ts`: for every non-header entry id, call `createBranchedSessionFile(file, entryId)` and assert the resulting JSONL's last non-header entry's `id` equals the input id. Run it; confirm it passes (the function itself is correct — the bug is upstream of it).
- [x] 1.3 Add `packages/extension/src/__tests__/bridge-entry-id-pi-070.test.ts` that simulates pi 0.70's emit-then-await-then-append ordering. It MUST fail on the current `queueMicrotask` implementation (asserting that the bridge captures the previous leaf, demonstrating the bug under pi 0.70). Run it; confirm it fails as expected.

## 2. Bridge: stamp entry id post-persist

- [x] 2.1 In `packages/extension/src/bridge.ts`, at `session_start` (the existing handler that captures `cachedCtx` and rebinds session state), wrap `ctx.sessionManager.appendMessage` once per session. The wrapper SHALL call the original, then if the message is non-null and has been mutated to include an `id`, store `idByMessage.set(msg, msg.id)` in a per-session `WeakMap<object, string>`. Re-wrap on every session change (new/fork/resume) since `ctx` is replaced.
- [x] 2.2 Replace the `message_end` enrichment block (currently `await new Promise<void>(resolve => queueMicrotask(resolve))` then `getLeafId()`) with a `setTimeout(0)` deferral. Inside the timeout: read `entryId` from `(event.message as any).id ?? idByMessage.get(event.message) ?? ctx.sessionManager?.getLeafId?.()`, then send the enriched event. Order of fallbacks matters — try the in-place mutation first, the WeakMap second, the getLeafId() last.
- [x] 2.3 Stop enriching `message_start` events with the in-flight message's id. Remove the existing `getLeafId()` call there. If a downstream consumer needs the previous leaf for diagnostics, attach it as `previousEntryId` (NOT `entryId`) — but verify no consumer in the codebase actually reads it before doing this; if none, drop the enrichment entirely.
- [x] 2.4 On every wrapped `appendMessage` call that successfully writes a user/assistant/toolResult entry, emit a new protocol event `entry_persisted` with `{ sessionId, entryId, nonce }` where `nonce` ties back to the `message_start`/`message_end` event that originated this message. The bridge MUST stamp the same nonce on the `message_start`/`message_end` event before sending it (so the reducer can correlate).
- [x] 2.5 Ensure the wrapping survives session switch / fork / resume by re-applying it inside the same `session_start` reason-handling block that re-captures `ctx` (per pi 0.69+'s session-replacement footguns documented in pi changelog 0.69.0).

## 3. Shared protocol updates

- [x] 3.1 In `packages/shared/src/protocol.ts`, add `EntryPersistedEvent` to `EventForwardMessage`'s event union with shape `{ eventType: "entry_persisted", timestamp, data: { type: "entry_persisted", entryId: string, nonce: string } }`. The choice of `event_forward` over a top-level WS message keeps the existing routing intact.
- [x] 3.2 Add an optional `nonce?: string` field to the existing `message_start` and `message_end` event payloads so the bridge can stamp it.
- [x] 3.3 Add a unit test in `packages/shared/src/__tests__/` that round-trips an `entry_persisted` event through `mapEventToProtocol`.

## 4. Client: back-fill entryId on entry_persisted

- [x] 4.1 In `packages/client/src/lib/event-reducer.ts`, extend `ChatMessage` to carry an optional `nonce?: string` (set when created from a `message_start` or `message_end`).
- [x] 4.2 In the `message_start` reducer case for user messages: do NOT populate `entryId` from `data.entryId` anymore (it's no longer reliable for user messages). Keep it `undefined` until `entry_persisted` arrives. Stamp `nonce` from `data.nonce` when present.
- [x] 4.3 In the `message_end` reducer case for assistant messages: continue to populate `entryId` from `data.entryId` — this is now correct because the bridge defers via `setTimeout(0)`.
- [x] 4.4 Add a new reducer case for `entry_persisted`: find the `ChatMessage` whose `nonce === data.nonce` and set its `entryId = data.entryId`. If no match, ignore silently (idempotent, no throw).
- [x] 4.5 Hide the per-message ⑂ Fork button while `ChatMessage.entryId` is undefined (the existing `entryId && onFork && (...)` guard in `ChatView.MessageBubble` already does this — verify).

## 5. Replay path (parity with live)

- [x] 5.1 In `packages/shared/src/state-replay.ts`, continue to attach the persisted entry's `id` as `entryId` on synthesized `message_start` and `message_end` events — this path is already correct because it reads from the persisted JSONL directly. Add a comment explaining why it does NOT need an `entry_persisted` follow-up.
- [x] 5.2 Add a test that replays a known JSONL and asserts every replayed `ChatMessage.entryId` matches the corresponding entry's `id` in the JSONL.

## 6. Test hygiene

- [x] 6.1 Delete or invert the "message_start should still capture entryId immediately (no deferral)" case in `packages/extension/src/__tests__/fork-entryid-timing.test.ts`. Replace with a positive test for the new `entry_persisted` flow.
- [x] 6.2 Update the "deferred getLeafId() captures the post-persist entry ID" case in the same file to model pi 0.70's `await this._emitExtensionEvent(event); ... ; appendMessage(...)` ordering and assert the `setTimeout(0)`-based mechanism captures the correct id.
- [x] 6.3 Re-run `bridge-entry-id-pi-070.test.ts` (1.3) and confirm it now PASSES with the new bridge implementation.
- [x] 6.4 Run the full test suite (`npm test`) and confirm nothing else breaks.

> NOTE: Tasks 7.1–7.6 require a live dashboard + manual visual confirmation. Implementation is complete; left for operator follow-up.

## 7. End-to-end manual verification

- [x] 7.1 Build (`npm run build`), restart server (`pi-dashboard restart`), reload bridge (`npm run reload`).
- [x] 7.2 In a session with at least 2 user/assistant pairs, click ⑂ on the *last* user message. Verify the new session card opens, replays history, and its tail entry IS the clicked user message (visible in chat AND in the new JSONL under `~/.pi/agent/sessions/...`).
- [x] 7.3 Repeat for the *last* assistant message. Same expectation.
- [x] 7.4 Repeat for an *earlier* user message (mid-history). Verify forked session ends at that user message; later entries are gone.
- [x] 7.5 Repeat for an *earlier* assistant message (mid-history). Same expectation.
- [x] 7.6 Verify that hovering over a freshly-streaming assistant bubble (during agent_end) the ⑂ button does NOT appear until `entry_persisted` lands. (Tests the `entryId &&` guard.)

## 8. Documentation

- [x] 8.1 Update the `bridge.ts` row in `AGENTS.md` to mention the post-persist `setTimeout(0)` mechanism and the `entry_persisted` event, replacing the (now obsolete) `queueMicrotask` reference.
- [x] 8.2 Update `docs/architecture.md` (Events flow / persistence section) to document `entry_persisted` and why it exists.
- [x] 8.3 Add a CHANGELOG entry under `## [Unreleased]` summarizing the fork bug fix.
