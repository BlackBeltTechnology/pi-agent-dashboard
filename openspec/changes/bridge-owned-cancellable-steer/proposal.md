# Proposal

## Why

A steer sent from the dashboard cannot be taken back, and a steer carrying images gives no sign of them (#1133, #1132). The bridge hands each steer to pi the moment it is sent, and pi's `ExtensionAPI` (re-verified at pi-coding-agent 1.5.0) exposes no way to remove a queued message — so once sent, it is out of reach. The archived `rework-mid-turn-prompt-queue` (D5) made this permanent on the premise that steers drain within 1–15 s and that a bridge-owned steer queue would race the drain. Both premises fail: a turn running a long tool or subagent holds a steer for minutes, and pi awaits extension `turn_end` handlers *before* it drains the steer queue, giving the bridge a single, race-free hand-off point. D5 asked for user evidence before any reversal; the evidence is #1133 / #1132 and the user's explicit direction in this change's planning session to make steers cancellable.

## What Changes

- Bridge holds dashboard-originated steers in its own buffer (`{ id, text, images? }`) instead of calling `pi.sendUserMessage(…, { deliverAs: "steer" })` at send time.
- Bridge hands held steers to pi inside its awaited `turn_end` handler on completed turns only, before pi drains — the oldest when pi's `steeringMode` is `"one-at-a-time"` (pi's default), all when `"all"`. A handed-off steer leaves the buffer in the same step and is no longer cancellable; pi renders it as a user message in the same boundary.
- Held steers not handed off by the time the run settles (sent after the last turn, aborted or failed run) drain as fresh prompts ahead of follow-ups, one per settle.
- A streaming steer's `prompt_received` ack carries no `promptId` until the steer reaches pi; the bridge acks it at hand-off. A cancelled steer never acks.
- Bridge re-announces its queues on every (re-)register, so a bridge restart never leaves stale steer bubbles.
- New browser→bridge mutations: cancel one held steer by stable `id`, clear all held steers. A cancel that arrives after hand-off is refused with feedback ("already sent or cancelled"), never silently ignored.
- **BREAKING (wire)**: `queue_update.steering` changes from `string[]` to `{ id, text, imageCount }[]` (mirrors follow-up views; image bytes never cross the wire). Client tolerates legacy `string[]` for one release.
- Pending steer bubble (`ChatView`) gains the follow-up controls verbatim: per-entry ✕ remove in the body row, an image-count badge, and `Clear all` below the stack from two entries on. No confirmation. The accepted mock's "Delivering" step is dropped: the bubble disappears at hand-off.
- Reverses the "Steer queue is permanently pi-owned + display-only" requirement (archived D5).
- Out of scope: steers typed in pi's own TUI (still pi-owned, not visible, not cancellable); steer edit/promote; the REST `delivery` gap (#1159).
- Mockup: mockups/2026-11-12-steer-cancel-images (in this change)

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `mid-turn-prompt-queue`: steer routing becomes a bridge-owned buffer handed to pi at `turn_end`; the steer shadow-queue requirement is replaced by bridge-owned buffers with ids + images; the steer bubble gains cancel / clear-all / image marker; the "permanently pi-owned + display-only" requirement is removed; the capture-before-send, server cache and abort requirements cover held steers.

## Impact

- `packages/extension/src/command-handler.ts` — steer branch buffers instead of sending.
- `packages/extension/src/bridge.ts` (both steer routing sites, settle drain), `bridge-handlers/lifecycle.ts` (`registerTurnEnd`), `bridge-handlers/forwarders.ts` (`message_start` matcher, `agent_settled`), `bridge-handlers/dispatch.ts` (new mutation arms).
- `packages/shared/src/protocol.ts`, `browser-protocol.ts`, `types.ts` — `queue_update.steering` view shape, new mutation messages, `pendingQueues.steering` type.
- `packages/shared/src/ws-message-tiers.ts`, `packages/server/src/identity/ws-message-scope.ts` — register new message types.
- `packages/server/src/browser-handlers/session-action-handler.ts`, `pairing/browser-gateway.ts` — relay new mutations; `acp-bridge/server-requests.ts` keeps dropping them (ACP out of scope).
- `packages/extension/src/followup-drain.ts` — settle drain ships leftover steers first; new `steer-buffer.ts`.
- `packages/client/src/components/chat/ChatView.tsx` (steer bubble → `PendingSteerCard`), `SessionCard.tsx`, `App.tsx`, `lib/chat/live-arrival.ts` (steering consumers, keyed by `id`).
- Tests: `bridge-no-queue-mutation.test.ts` negative assertions change; `ChatView.inline-steer.test.tsx` no-cancel assertion inverts.
- Trade-off: held steers live in bridge memory, so a bridge restart (`npm run reload`) mid-turn drops them; today they survive inside pi.
- Depends on pi behaviour: `turn_end` extension handlers awaited before `getSteeringMessages()` (`pi-agent-core/dist/agent-loop.js:184-191`); a spike verifies enqueue timing.

## Discipline Skills

- `doubt-driven-review` — reverses a permanent spec decision and breaks the `queue_update` wire shape.
- `node-inspect-debugger` — spike on enqueue timing inside the awaited `turn_end` handler (opaque pi runtime ordering).
- `systematic-debugging` — if the spike shows a steer slipping past the drain.
- `review-code` — before commit.
