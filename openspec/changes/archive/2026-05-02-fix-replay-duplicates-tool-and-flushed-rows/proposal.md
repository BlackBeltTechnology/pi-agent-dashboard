## Why

Long-lived dashboard sessions accumulate **massive `messages[]` duplication** across reconnects. A 5-day-old session (`019de212-7d47-7322-afdd-245be4b9a629`, `remove-flow-dialog-interceptors`) with **50 unique `toolCall` ids in `events.jsonl`** renders as **14–16 copies of every tool card in the DOM** — ~600+ rendered rows for ~50 actual tool calls.

Symptom: the user "scrolls a little up and back down" in the chat and experiences **never-ending scrolling** because the chat container's `scrollHeight` is enormous and packed with duplicate tool runs that look identical.

Three independent failure points in the client reducer's replay path stack to produce this:

1. **`useMessageHandler.ts::case "event_replay"`** resets `SessionState` to `createInitialState()` **only** when the *first event in the batch* has `seq === 1`. Any reconnect whose first replay batch starts at `seq > 1` (lazy-loaded paginated replay, multi-batch boundary, or any out-of-order delivery) skips the reset and **appends a fresh full replay onto the existing state**.
2. **`event-reducer.ts::case "tool_execution_start"`** unconditionally pushes a new `toolResult` row with `id: tool-${toolCallId}`. There is no "row with this id already exists → update in place" branch. Replaying the same `tool_execution_start` twice produces **two React rows with identical keys** — React renders both, doubling the chat height per replay round.
3. **`event-reducer.ts::flushStreamingTextAsAssistantRow`** (added in 070ddef9, change `fix-streaming-text-vs-interactive-ui-order`) pushes a NEW assistant row with `id: msg-${state.messages.length}`. The id depends on array length, so every replay produces a **fresh, unique key** — there is no possibility of dedup at the React layer. Each replay round creates one extra never-deduped row per tool that had streaming text in front of it.

Failure (1) is the root cause; (2) and (3) are amplifiers. Without (1), (2) and (3) are unreachable. With (1), they multiply: each spurious replay round adds N tool-rows + N flushed-assistant-rows + their ordering reshuffles.

The bug exists pre-070ddef9 (only via path 2) but became severe afterwards because path 3 has no key collision at all — every replay strictly grows `messages[]`. The user confirmed the symptom is reproducible on `019de212-7d47-7322-afdd-245be4b9a629` and tied it to that commit.

This change closes all three paths with three local, low-risk reducer/handler edits — no protocol changes, no server changes.

## What Changes

Three orthogonal idempotency fixes. Any one alone reduces severity; the combination closes the bug.

- **Fix A — Reset state on every full replay** (`packages/client/src/hooks/useMessageHandler.ts`)
  - Replace the `firstSeq === 1` reset gate with a robust "is this batch part of a fresh replay sweep?" check. Concretely: reset when **`firstSeq === 1` OR `firstSeq <= maxSeqMapRef.current.get(sid)`** — i.e. the server is replaying events the client has already seen. The latter clause catches every reconnect-driven re-replay regardless of pagination boundaries.
  - Keep the existing `next.get(msg.sessionId) ?? createInitialState()` fallback so genuinely new mid-stream batches still append correctly.

- **Fix B — Idempotent `tool_execution_start`** (`packages/client/src/lib/event-reducer.ts`)
  - In `case "tool_execution_start"`, before pushing the new `toolResult` row, do a tail-backwards scan for an existing row with `m.toolCallId === toolCallId`. If found, **update in place** (refresh `args`, `toolStatus`, `startedAt`, `timestamp`) instead of pushing a duplicate.
  - Defense-in-depth: even after Fix A, this guarantees the reducer is mathematically idempotent on `tool_execution_start` so any future replay-pathology cannot reintroduce duplicate React keys.

- **Fix C — Stable id for flushed assistant rows** (`packages/client/src/lib/event-reducer.ts`, function `flushStreamingTextAsAssistantRow`)
  - Replace `id: \`msg-${state.messages.length}\`` with a content-stable id derived from the in-flight tool's `toolCallId` plus a `flush-` prefix. The flushed row precedes a tool, so the upcoming `tool_execution_start.toolCallId` is the natural anchor. The function signature gains a required `toolCallId` parameter; the single caller in `case "tool_execution_start"` already has it in scope.
  - On replay, the same `tool_execution_start` event triggers the same flush call, which now produces the **same id** — a duplicate flush gets deduped via the same find-or-update pattern as Fix B.

After this change, replaying the entire event log of any session N times produces the **same `messages[]`** as replaying it once. Verified by adding a property-style test that runs the full event stream of session `019de212…` through the reducer twice and asserts deep equality of `state.messages`.

## Capabilities

### Modified Capabilities

- **`event-reducer`** — Adds an idempotency requirement: replaying the same event sequence multiple times against the same starting state SHALL produce the same `messages[]`. `tool_execution_start` SHALL update an existing row keyed by `toolCallId` in place rather than pushing a duplicate. `flushStreamingTextAsAssistantRow` SHALL use a content-stable id derived from the upcoming `toolCallId`, not from `messages.length`.

(No spec changes for `useMessageHandler` — its replay-reset behavior is implementation detail of the dashboard shell, not a capability spec'd in `openspec/specs/`. The fix is covered by unit tests.)

## Impact

**Affected code**

- `packages/client/src/hooks/useMessageHandler.ts` — Fix A (one branch in `case "event_replay"`).
- `packages/client/src/lib/event-reducer.ts` — Fix B (one new findLastIndex + branch in `tool_execution_start`); Fix C (signature + body of `flushStreamingTextAsAssistantRow`, plus one updated callsite). The hard-clamp + R7-defense-in-depth invariants from 070ddef9 are preserved unchanged.

**No protocol changes.** `event_replay` message shape, `tool_execution_start` event shape, and the `ChatMessage` schema are untouched. Existing browser ↔ server traffic is unaffected.

**Tests**

- `packages/client/src/lib/__tests__/event-reducer.replay-idempotency.test.ts` — replays the full event stream of `019de212-7d47-7322-afdd-245be4b9a629` (or a synthetic equivalent) twice; asserts `state.messages` deep-equals after both runs.
- `packages/client/src/lib/__tests__/event-reducer.tool-start-idempotent.test.ts` — pins that two consecutive `tool_execution_start` events with the same `toolCallId` produce one row, not two; row's `toolStatus` and `startedAt` reflect the latest event.
- `packages/client/src/lib/__tests__/event-reducer-streaming-text-flush.test.ts` (existing) — extend with a "flush row id is stable across replay" scenario.
- `packages/client/src/__tests__/useMessageHandler-replay-reset.test.tsx` — pin that a second `event_replay` whose `firstSeq <= maxSeq` resets state instead of appending.

**Risks**

- **Fix B in-place update**: must NOT clobber `result`, `images`, `duration`, or `toolStatus` if the existing row is already in `complete`/`error` state. Mitigation: only update if the existing row's `toolStatus === "running"` (or rebuild only the fields `tool_execution_start` is responsible for, leaving `result`/`images`/`duration` alone).
- **Fix C id stability**: a content-stable id requires one tool per flush. If a future `flushStreamingTextAsAssistantRow` is called twice within one assistant message (R7 invariant says it cannot), the ids would collide. The R7-defense-in-depth flag (`streamingTextFlushed`) already prevents that; this change preserves it.
- **Fix A reset trigger**: a reconnect mid-streaming-message could theoretically drop an in-progress streaming text. Mitigation: replay sends the full message_end on reconnect, so streamingText is recovered. Additional regression test pins this.
