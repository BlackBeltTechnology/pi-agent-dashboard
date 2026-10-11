## Why

`GET /api/sessions/:sessionId/tool-result/:toolCallId` answers `404` in three different situations (`packages/server/src/routes/session-routes.ts`, ~`:199-217`):

1. the tool call is still running;
2. its `tool_execution_end` was trimmed from the in-memory store (`trimBufferToLimit` / global reclaim, 32 MiB per session);
3. the call or session is unknown.

The client's stale-tool reconcile (`packages/client/src/hooks/useStaleToolReconcile.ts`) ticks every 5 s and probes each `running` row older than 25 s, re-arming a row every 15 s, across **all** loaded sessions. Observed on 2026-10-11:

- **Normal operation looks broken.** Every long tool (Agent reviews, `sleep 240`, builds) shows up as a column of red `404`s in DevTools, which reads like a fault or a security problem.
- **Lost results heal slowly and only conditionally.** A trimmed result (case 2) is indistinguishable from case 1. The client therefore needs ≥2 rounds (~40 s) plus a later assistant turn (the Superseded terminal heal) before it gives up.

## What Changes

- **Server records evictions as facts.** When the store drops a real stored `tool_execution_end` (in either trim path), it records the `toolCallId` in a small, bounded, per-session evicted-end record. Synthesized ends carrying `healedBy` are never recorded, and a live start removes its id. The record lives on the session buffer and is freed with it.
- **Server keeps an in-flight hint.** A live-fed, per-session set of top-level calls with a live start and no live end. It is emptied on `agent_settled`, `session_register`, session end and session removal, and capped per session. A call already running across a bridge reconnect keeps answering `404` until it ends. It is used only to answer `202` instead of `404`, and it never finalizes anything.
- **The route answers, in order:**
  - `200 { result, isError }`: an end is stored (unchanged);
  - `410 { error: "result no longer available" }`: the id is in the evicted-end record;
  - `202 { pending: true }`: the id is in the in-flight hint **and** the client opted in with `?pending=1`;
  - `404`: everything else (today's answer).
- **Client reconcile reads the status.**
  - It sends `?pending=1`.
  - `202` keeps the spinner, with no red row. It still counts toward the supersede heal's probe count, so a stale hint can never strand a finished tool.
  - `410` finalizes the row immediately, with `healedBy: "result_evicted"`.
  - `404` is unchanged.
- **Full output:** "Show full output" shows the localized "result evicted" notice for `404` and `410`, not the raw body text.
- **Compatibility:**
  - `202` is opt-in, because an old tab treats any 2xx as a result. An old tab sees `410` as non-2xx, which it already handles like `404`. Its only visible difference is "Show full output" text: it prints the body's `error`, so a `410` there shows "result no longer available" instead of "tool call still in flight or unknown".
  - A new client against an old server only ever gets `200`/`404`, so it behaves as it does today.

## Capabilities

### New Capabilities

None.

### Modified Capabilities
- `dashboard-server`: the tool-result route gains `410` (recorded eviction) and opt-in `202` (in-flight hint), and its scenarios change.
- `incremental-event-sync`: "Stale running-tool reconcile" handles `202`/`410`. "Superseded terminal heal" counts `202` alongside `404`.
- `bash-execution`: "Show full output affordance" maps `404` and `410` to the localized evicted notice.

## Impact

- **Code:**
  - `packages/server/src/persistence/memory-event-store.ts` (evicted-end record in both trim paths, plus a lookup);
  - a new `packages/server/src/session/in-flight-tool-calls.ts`, fed from the live branch of `packages/server/src/event-wiring.ts`;
  - `packages/server/src/routes/session-routes.ts` and its wiring in `server.ts`;
  - `/api/health` counters (`packages/server/src/routes/system-routes.ts`);
  - `packages/client/src/hooks/useStaleToolReconcile.ts`, `packages/client/src/hooks/useToolFullResult.ts`, `packages/client/src/lib/chat/event-reducer.ts`, `packages/client/src/components/chat/ToolCallStep.tsx` (eviction badge).
- **API:** the response contract of an existing guarded route changes. No new endpoint.
- **Memory:**
  - The evicted-end record is capped per session and freed with the buffer.
  - The in-flight hint is capped at 256 ids per session and is emptied at `agent_settled`, register, session end and session removal.
- **Migration / rollback:** no persisted data. Revert to roll back.
- **Related:** `fix-stuck-tool-card-superseded-heal` (archived) parked a server-side "terminal-event keepalive". This change is complementary: it records losses instead of preventing them.

## Discipline Skills

- `observability-instrumentation`: `202`/`410` answers are counted in `/api/health` next to `storeTrim`.
- `doubt-driven-review`: the `410` path relaxes the "SHALL NOT synthesize a completion from the reconcile path" invariant. Planning ran it twice. Cycle 1 showed that vouching for "not in flight" from session state produced false `410`s. Cycle 2 showed status-based gates are unsound too, so `410` is now based only on a recorded eviction. Cycle 3 (the last allowed) excluded synthesized orphan-close ends and re-emitted ids from the record.
- `review-code`: before commit.
- No `security-hardening` trigger. Both existing guards stay, and the only new input is a boolean query flag.
