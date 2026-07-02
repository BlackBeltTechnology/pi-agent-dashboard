# Re-introduce optimistic prompt feedback, scoped to idle sends, with a progressing send-state visual

## Why

When a user sends a prompt to an **idle** session, the chat shows nothing for the full server round-trip (observed: several seconds) until the bridge emits the user `message_start` event and the reducer renders the bubble. The input clears instantly, so the user is left staring at an empty timeline with no confirmation their message was sent.

This feedback **used to exist**. The `optimistic-prompt` capability set `pendingPrompt` on send and rendered an optimistic bubble. Commit `0375da1b` (v2 shadow queues) **deleted the write site** in `useSessionActions.handleSend`, leaving:

- The render block in `ChatView.tsx:608` as dead code (comment: *"Write site removed in v2; this block stays dead-code"*).
- The `PendingPrompt` type, `usePendingPromptTimeout` safety timer, and reset-carry logic in `useMessageHandler` all intact but never triggered.
- The `optimistic-prompt` **spec** still describing the v1 behaviour — so spec and code now disagree.

### Why v2 deleted it (the trap to avoid)

The v1 write was **unconditional** — it set `pendingPrompt` on *every* send, including mid-turn sends that become bridge-owned queue entries (steer / follow-up). That created a class of "ghost reappearance" bugs, each patched separately:

| Bug | Cause | Band-aid commit |
|---|---|---|
| Clear-all re-shows card | `queue_state{pending:[]}` arrives → suppression rule `!queuedTexts.includes(text)` un-fires | `9c954622` |
| Per-chip remove re-shows card | removed entry text matches `pendingPrompt.text` → same un-fire | `9c954622` |
| Abort leaves spinner forever | `pendingPrompt` lingers after kill | `d3e86f24` |

Three commits piling clears onto one unconditional write. v2 deleted the write rather than keep patching. **Every one of those bugs is a mid-turn / queue collision** — none occur for idle sends, because idle sends never enter the queue (`queuedTexts` is empty, nothing to un-fire).

### The insight

The idle case lost its feedback as collateral damage. We can restore it **without re-opening the bug class** by scoping the optimistic write to idle / fresh-turn sends only. Mid-turn keeps its authoritative `pendingQueues` rendering (per `mid-turn-prompt-queue`), untouched.

Additionally, the user asked for a **progressing** visual rather than a static spinner: `sending → sent → confirmed`, so the bubble communicates delivery progress instead of an indefinite spin.

## What Changes

- **Re-wire the write site, scoped to idle.** `useSessionActions.handleSend` (and `handleSendPromptToSession`) SHALL set `pendingPrompt` **only when the session is not mid-turn** at send time. Mid-turn sends SHALL NOT write `pendingPrompt` — they remain governed by `mid-turn-prompt-queue`.
- **Add a `status` to `PendingPrompt`.** Extend `{ text, images? }` with `status: "sending" | "sent"`. `"sending"` on write; `"sent"` once the bridge acknowledges receipt; cleared entirely (→ confirmed) when the user `message_start` event lands.
- **Progressing bubble render.** Re-activate the `ChatView` optimistic block with three visual states sharing identical bubble geometry (`bg-blue-500/10 border-l-2 border-l-blue-400 rounded-xl`):
  - `sending` — 60% opacity, animated left-edge pulse + faint sweep, spinner + "sending".
  - `sent` — full opacity, spinner morphs to a green check + "sent".
  - `confirmed` — status chip fades out; bubble is now identical to a server-sourced user card. **Zero layout shift** between states (same dimensions/position).
- **Drop the `queuedTexts` suppression band-aid.** Because the write is idle-scoped, the optimistic bubble can never co-exist with a queue chip. The `!queuedTexts.includes(pendingPrompt.text)` guard and its dependent clears (clear-all, per-chip remove) are removed. Abort/turn-end clears stay (already in the event-reducer at 6 sites).
- **Resolve the same-tick race authoritatively (see `design.md`).** The idle-vs-mid-turn decision SHALL key off the bridge's `capture-before-send` streaming gate (the same gate that already prevents a false STEERING chip on an idle send), NOT a possibly-stale client `state.status` snapshot. Two options are weighed in `design.md`; the proposal selects the bridge-ack option.
- **Spec reconciliation.** Update the `optimistic-prompt` spec so it matches the scoped v2-aligned behaviour (idle-only write, `status` field, progress states) and explicitly cedes the mid-turn path to `mid-turn-prompt-queue`.
- **Mockup.** `openspec/changes/optimistic-prompt-progress/mockup/index.html` — interactive, token-accurate (current vs. proposed, plus the three static frames).

## Capabilities

### Modified Capabilities

- `optimistic-prompt` — write site scoped to idle sends; `PendingPrompt` gains `status`; render gains the three progress states; `queuedTexts` suppression and its clears removed (the collision they guarded against can no longer occur once idle-scoped).
- `mid-turn-prompt-queue` — **no spec change**; reaffirmed unchanged. The cross-reference clarifying that idle sends are out of its scope lives in the `optimistic-prompt` delta, so no `mid-turn-prompt-queue` requirement is modified.

## Impact

- **Idle send** — instant bubble (`sending`) → ack (`sent`) → seamless confirm. Removes the multi-second blank gap.
- **Mid-turn send** — unchanged. Queue chips / steer ghost bubbles render exactly as today.
- **Bug class avoided by construction** — clear-all / per-chip-remove ghost reappearance cannot occur (no optimistic state mid-turn). Abort cleanup inherited free from existing event-reducer clears.
- **Code impact** — re-wire `handleSend` / `handleSendPromptToSession` (idle guard + status), extend `PendingPrompt` type (`event-reducer.ts:115`), re-activate + restyle the `ChatView.tsx:608` block, remove the suppression guard, and (if bridge-ack chosen) a small `prompt_received` ack message in the bridge + protocol + reducer.
- **Open design decision** — whether `"sent"` is a real bridge ack or a cosmetic timer. Resolved in `design.md`; affects whether the bridge/protocol change is in scope.
- **Out of scope**:
  - **Not touching the mid-turn queue rendering, drain, or shadow-queue logic.** `mid-turn-prompt-queue` is authoritative there.
  - **Not adding optimistic feedback for mid-turn sends** — they already have authoritative chips.
  - **Not changing the 30s safety timeout** — `usePendingPromptTimeout` stays as-is, now only ever armed for idle sends.
  - **Not persisting `pendingPrompt` server-side** — it remains transient client UI state.
