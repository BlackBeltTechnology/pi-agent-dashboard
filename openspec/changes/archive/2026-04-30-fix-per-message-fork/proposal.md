## Why

Clicking the per-message ⑂ Fork button on **either** a user or an assistant chat bubble produces a forked session whose history ends one entry **before** the bubble that was clicked. The selected message is missing from the new session entirely.

Root cause: pi 0.69 changed extension dispatch — `_processAgentEvent` now does `await this._emitExtensionEvent(event)` (which awaits each handler) **before** running `_emit(event)` and **before** `sessionManager.appendMessage(event.message)`. The bridge's existing `queueMicrotask` deferral on `message_end` (added by capability `fork-entryid-accuracy`) was designed for the older synchronous `_emit` → `appendMessage` ordering and no longer reaches past `appendMessage`, so `getLeafId()` still returns the **previous** leaf. The result: every chat bubble carries the entry id of the entry that came before it, and `createBranchedSessionFile(file, entryId)` prunes off the clicked entry. The dashboard pins `pi >= 0.70.0` (lockstep), so this regression affects every supported pi version today.

## What Changes

- Stop trying to fish the entry id out of pi at emit time. Make the bridge stamp `entryId` on `message_start`/`message_end` events using a **post-persist signal** that is reliable on pi 0.70.x — by reading `ctx.sessionManager.getBranch()` from the **next** event tick (the next `pi.on(...)` callback after the message has been persisted), or equivalently by hooking `ctx.sessionManager.appendMessage` once at `session_start` and stamping ids by reference identity on the just-appended message. Whichever approach the design chooses, the contract is: every `entryId` the bridge sends MUST equal the entry that the bubble's content actually represents in the persisted JSONL.
- Replace the existing `queueMicrotask` deferral in `bridge.ts` `message_end` enrichment with the new mechanism. Remove the encoded "stale leaf is correct" assumption from the existing `fork-entryid-timing` test. Update or replace `fork-entryid-accuracy` scenarios so they reflect post-persist semantics (not "previous leaf" or "queueMicrotask").
- Treat `getLeafId()` on `message_start` (user) the same way: stamp the **just-emitted user entry's id**, not the previous assistant entry. This is a **BREAKING** change to `fork-entryid-accuracy`'s "Scenario: message_start entryId unchanged" — that scenario codifies the bug.
- Keep the rest of the fork pipeline as-is: `createBranchedSessionFile(file, entryId)` + `spawnPiSession --fork <pruned-file>` continues to work once the entry id is correct. No protocol changes, no client changes, no spawn-mechanism changes.
- Add a regression test that round-trips a real pi 0.70 session: spawn → user prompt → assistant reply → click ⑂ on each bubble → assert the new JSONL contains the clicked entry as its tail.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `fork-entryid-accuracy`: change the requirement so `entryId` on **both** `message_start` and `message_end` is the **own entry id of the message the event represents**, captured via a post-persist mechanism. The current "Scenario: message_start entryId unchanged" (which expects the previous-leaf id) is **REMOVED** and replaced with a scenario asserting the user message's own id.
- `fork-from-message`: scenarios that say `createBranchedSessionFile` is called with `entryId` (the bubble's id) remain correct in shape, but the **end-to-end** assertion changes — the resulting JSONL MUST contain the clicked entry as its tail (not as N-1).

## Impact

- **Code**: `packages/extension/src/bridge.ts` (entryId enrichment for `message_start` and `message_end`); `packages/shared/src/state-replay.ts` already attaches the correct id from persisted entries (no change needed).
- **Tests**: `packages/extension/src/__tests__/fork-entryid-timing.test.ts` (currently encodes the bug — must be inverted or replaced); new round-trip test against a real session JSONL fixture.
- **Compatibility**: targets pi 0.70.x (the dashboard's pinned minimum). Pre-0.69 pi is no longer supported by the dashboard, so we do not need to keep the old `queueMicrotask` path.
- **No protocol changes**: `resume_session { mode: "fork", entryId }` stays the same. The browser, server, and pi-gateway are unchanged.
- **No spawn-pipeline changes**: still uses `pi --fork <pruned-file>` via `createBranchedSessionFile`. Switching to `ctx.fork()` or RPC `{type:"fork"}` is a future architectural change, intentionally **out of scope** for this fix.
- **Existing fork-from-message scenarios**: unchanged in shape; pass-through behavior is preserved once entry ids are correct.
