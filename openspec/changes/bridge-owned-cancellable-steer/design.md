# Design

## Context

See proposal.md (Why). Current state:

- Two steer routing sites send to pi at once: `command-handler.ts:970-971` (`sendUserMessageWithImages` → `onSteerSent(outgoing)`, text only) and the slash-route `sessionPrompt` fallback `bridge.ts:1571-1572` (`pi.sendUserMessage` → `recordSteerSent`). Both compute `buffered` as follow-up only (`command-handler.ts:949`, `bridge.ts:1558`); that one flag drives BOTH routing (buffer vs send) and the `promptId` on `prompt_received` (`packages/server/src/pending/pending-prompt-acks.ts:1-16`, consumed `server/src/event-wiring.ts:2120-2124`).
- Steer state is a text shadow `inst.bridgeSteering: string[]` (`bridge.ts:537`, `recordSteerSent` `bridge.ts:569-576`), spliced by the `message_start` matcher (`bridge-handlers/forwarders.ts:382-393`).
- `queue_update` is emitted only on mutation (`bridge.ts:540-549`) or on a non-empty reset (`bridge-handlers/lifecycle.ts:124-128`); the server keeps the last cached `pendingQueues` across a bridge restart (`server/src/event-wiring.ts:2104-2112`).
- Wire: `queue_update.steering: string[]` (`packages/shared/src/protocol.ts:21`); `pendingQueues.steering: string[]` (`packages/shared/src/types.ts:570`).
- Client consumers of `steering` as strings: `ChatView.tsx:2653-2662` (inline bubble keyed by `steerText.slice(0,16)`, no controls), `ChatView.tsx:417,2198` (`EMPTY_STEERING_TEXTS`), `App.tsx:426` (`EMPTY_STEERING`), `lib/chat/live-arrival.ts:79-83,124-131,179` (arrival map keyed by steer text), `SessionCard.tsx` (count). `components/__tests__/ChatView.inline-steer.test.tsx:92-95` asserts no cancel button.
- Embed idle reaper gates on `pendingQueues.steering` length (`server/src/embed-lifecycle/idle-reaper.ts:179`, `embed-lifecycle-controller.ts:115`; `openspec/specs/embed-session-lifecycle/spec.md:140-149`).
- Follow-up buffer: entries + images, cap + byte ceiling, no id (`packages/extension/src/followup-buffer.ts:79-102`). Admission validates and reports images (`bridge.ts:597-613`).
- Follow-up drain: one entry per `agent_settled`, after abort too (`forwarders.ts:138-150`); pops before send and returns `"pending"` while `ctx.hasPendingMessages()` (`followup-drain.ts:49-70`).
- New browser message types are registered in `packages/server/src/identity/ws-message-scope.ts:36-49` and `packages/shared/src/ws-message-tiers.ts:50` (coverage tests). ACP sessions drop unknown bridge messages (`packages/server/src/acp-bridge/server-requests.ts:39-62`).
- pi 1.5.0: ExtensionAPI has no queue removal; `sendUserMessage` returns `void`, and a failed send only reaches pi's internal `runner.emitError` (`pi-coding-agent/dist/core/agent-session.js:2792-2799`). `finishTurn` awaits extension `turn_end` handlers (`agent-session.js:536-541`, `_dispatchTurnEndBoundary` `:500-530`), whose event carries `outcome: "completed" | "aborted" | "error"` (`extensions/types.d.ts:771`). On a completed turn pi then drains steers (`pi-agent-core/dist/agent-loop.js:184-191`); on aborted/error it returns without draining (`agent-loop.js:148-158`). `finishTurn` may return `action: "end"` (no drain; no producer in installed pi). `_dispatchTurnEndBoundary` skips handlers when the assistant entry id is unresolved (`agent-session.js:506-513`). Default `steeringMode` `"one-at-a-time"` (`settings-defaults.d.ts:5`), via `pi.getSettings()`.

## Goals / Non-Goals

**Goals:**
- A steer is in exactly one place: the bridge buffer (cancellable) or pi (not cancellable). One synchronous hand-off moves it.
- Reuse follow-up buffer semantics and controls.

**Non-Goals:**
- Tracking a steer after hand-off (no "delivering" state — see D4).
- Steer edit / promote; cancelling TUI-typed steers; ACP-session steer cancel; persisting held steers across bridge restart.

## Decisions

### D1. Hold in the bridge, hand off at a completed `turn_end`
Both routing sites put streaming steers in the steer buffer. `registerTurnEnd` (`bridge-handlers/lifecycle.ts:988`) hands off when `event.outcome === "completed"`.
- **Rejected — send now + tombstone via `context` hook / `context_edit`**: model sees the steer once; transcript keeps a cancelled message.
- **Rejected — wait for pi `clearSteeringQueue`**: not exposed; no per-entry removal even internally.
- **Rejected — client undo delay**: latency on every steer; no cancel once sent.

### D2. Remove first, then send (ordering)
Take the entries (one in `"one-at-a-time"`, all in `"all"`), remove them from the buffer and emit `queue_update` in one synchronous step, then send each oldest-first with one macrotask yield after each send (keeps pi's async `prompt()` chains in order). A cancel processed during the yields finds no entry → "already sent or cancelled". No cancel can reach an entry once a send for it can happen.

### D3. Ack follows the hand-off
Routing flags stay separate: `bufferFollowUp = wasStreaming && deliverAs === "followUp"`, `bufferSteer = wasStreaming && deliverAs === "steer"` (extending the old `buffered` flag would route steers into `bridgeFollowUp`). The buffered steer's ack omits `promptId`; the entry keeps it and the bridge emits `prompt_received { fresh: false, promptId }` at hand-off (turn_end or settle drain). A cancelled steer never acks — REST callers see "not delivered".

### D4. No post-hand-off tracking (user decision, cycle 3)
pi exposes no confirmation for an extension send. Cycles 1–3 showed every way of tracking "committed but not yet delivered" (in-handler `hasPendingMessages()` revert, settle reconciliation, text/FIFO attribution) produced duplicate delivery, wrong-card removal, silent loss, stale reaper state, or resurrected cleared steers. So the bubble disappears at hand-off; pi renders the user message in the same boundary.
- **Trade-off**: a hand-off pi rejects (send during compaction, another extension's `input` handler consuming it) is lost with only pi's own error — the same as any steer today. A slow `input` handler can make the steer land one boundary later; it is still delivered.
- The accepted mockup's "turn_end commit / Delivering / late cancel note" steps collapse to: bubble disappears; a late cancel gets a `command_feedback` toast.

### D5. Leftovers drain at settle, ahead of follow-ups
Generalise `drainFollowupQueue` (`bridge.ts:644`): on settle, ship the oldest held steer first (fresh prompt, images, ack with `promptId`), else the oldest follow-up — one per settle, same lock, idle/pending gates and abort behaviour. Covers: steer sent after the last completed `turn_end`, aborted/errored run, skipped handler, `action: "end"`.
- **Rejected — move into `bridgeFollowUp` head**: no prepend; admission can refuse on cap/bytes → silent loss.

### D6. Sibling module `steer-buffer.ts`
`createSteerBuffer(instanceNonce)` with entries `{ id, text, images?, promptId? }`, ids `<nonce>:<seq>` (never reused across bridge lifetimes), `views()`, `push` (same cap + byte ceiling constants as follow-up, accounted independently), `removeById`, `clear`, `take(mode)`, `shift`. Admission reuses the follow-up image validation + feedback path.

### D7. Re-announce queues on register
Emit `queue_update` with current buffers (empty included) on every register / re-register, so the server cache never shows a previous bridge's steers.

### D8. Wire + plumbing
- `SteerEntryView = { id, text, imageCount }`; `queue_update.steering` and `pendingQueues.steering` typed `(SteerEntryView | string)[]` for one release.
- `remove_steering_entry { sessionId, id }`, `clear_steering_entries { sessionId }`: shared protocol types, `ws-message-tiers.ts`, `ws-message-scope.ts`, `session-action-handler.ts`, `browser-gateway.ts`. ACP `server-requests.ts` keeps dropping them (non-goal), noted in a comment.
- `clear_steering_queue` stays deleted (negative test keeps it).

### D9. Client
Extract `PendingSteerCard` (key = `id`; legacy strings keyed by index), label `session.steering`; share follow-up control class constants (`QueuePanel.tsx`, `QueueLane.tsx`); `Clear all` from two entries. Retype `EMPTY_STEERING` / `EMPTY_STEERING_TEXTS`; key `live-arrival.ts` by `id`. Late cancel → existing `command_feedback` toast. Layout per accepted mockup `mockups/2026-11-12-steer-cancel-images` (minus the dropped Delivering steps).

## Risks / Trade-offs

- [Hand-off rejected by pi] → lost with pi's own error only; unchanged from today (D4).
- [pi reorders `turn_end` vs drain] → contract test against installed pi's `agent-loop.js`; failure mode: steer delivered at settle.
- [Steer sent during in-loop compaction] → today pi's loop-top poll (`agent-loop.js:110-117`) can deliver it before the next call; now it waits for that turn's `turn_end`: one turn later. Accepted (narrow window).
- [Bridge restart drops held steers] → today they survive inside pi. Accepted (same as follow-ups); D7 clears stale bubbles. Noted in docs.
- [Embed reaper] → held steers keep `steering` non-empty and block reaping while held; they drain at settle, so the count returns to 0. No delta to `embed-session-lifecycle` needed.
- [Mixed versions] → client accepts legacy strings; old client ignores `id` (no cancel).

## Migration Plan

Ship bridge + server + client together. Rollback = revert; held steers are in-memory only.

## Open Questions

None blocking. Spike (tasks 1.x) records same-boundary delivery and `"all"`-mode order.
