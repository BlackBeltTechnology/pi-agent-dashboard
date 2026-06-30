# Design — optimistic prompt feedback (idle-scoped, progressing)

## Context

`optimistic-prompt` (v1) set `pendingPrompt` on every send and rendered an optimistic bubble. The `mid-turn-prompt-queue` v2 work (`0375da1b`) made the bridge the authoritative owner of mid-turn queue state (`pendingQueues`, fed by `queue_update`) and **deleted the v1 write site** because the unconditional optimistic write collided with that authority — producing the ghost-reappearance bug class (clear-all, per-chip remove, abort), patched across `9c954622` + `d3e86f24` before being removed wholesale.

The dead render block survives at `ChatView.tsx:608`; the `PendingPrompt` type, safety timer, and reset-carry logic survive. This change re-connects the write, scoped so the collision cannot recur, and adds a progress-state visual.

## Decision 1 — Scope the optimistic write to idle / fresh-turn sends

```
                       handleSend(text, delivery?)
                                  │
              ┌───────────────────┴───────────────────┐
              ▼                                        ▼
   ┌─────────────────────┐                ┌──────────────────────────┐
   │  SESSION IDLE        │                │  AGENT MID-TURN          │
   │  fresh turn          │                │  → queue entry           │
   ├─────────────────────┤                ├──────────────────────────┤
   │ write pendingPrompt  │                │ NO pendingPrompt write    │
   │ render optimistic    │                │ authoritative pendingQueues│
   │ bubble (this change) │                │ + steer ghost bubbles     │
   │                      │                │ (mid-turn-prompt-queue,   │
   │                      │                │  unchanged)               │
   └─────────────────────┘                └──────────────────────────┘
```

**Why this is safe:** every v2-era ghost bug required a non-empty queue to un-fire the suppression rule. Idle sends never enter the queue, so:

- The `!queuedTexts.includes(pendingPrompt.text)` suppression guard becomes unnecessary — delete it.
- The manual `pendingPrompt` clears on `clear_queue` / `remove_queue_entry` become unnecessary — those paths only run mid-turn, where no `pendingPrompt` exists.
- Abort / turn-end clears stay: the event-reducer already nulls `pendingPrompt` at 6 sites (`event-reducer.ts:855,869,930,1507,1527,1581`). An idle optimistic bubble inherits this cleanup for free.

**Alternative considered — keep the unconditional write + smarter suppression.** Rejected: this is exactly what v2 abandoned after three band-aid commits. The suppression rule is text-equality based and breaks on duplicate prompts ("yes", "continue") and edited entries. Idle-scoping removes the failure mode at the source rather than patching it.

## Decision 2 — Source of the idle-vs-mid-turn verdict (the same-tick race)

The one genuine hazard: the client decides "idle" from `state.status`, but the agent starts a turn in the **same tick**, so the prompt actually lands mid-turn and becomes a queue entry → optimistic bubble AND queue chip render the same text.

```
 client snapshot says "idle" → writes optimistic bubble
        │  ...but pi flips streaming sync inside agent_start emit
        ▼
 prompt lands mid-turn → queue entry → DOUBLE render (narrowed v1 bug)
```

The bridge already solved the mirror of this. `0375da1b`: *"Capture-before-send streaming gate — snapshot `isAgentStreaming` BEFORE `pi.sendUserMessage` so an idle send doesn't produce a false STEERING chip when pi flips the flag sync inside its agent_start emit."* The bridge holds the **authoritative** idle/streaming verdict at send time; the client's `state.status` is a lagging mirror.

**Decision:** the optimistic bubble's lifecycle is driven by a **bridge acknowledgement**, not the client snapshot. Flow:

1. Client writes `pendingPrompt { status: "sending" }` optimistically (client snapshot says idle — best-effort, instant feedback).
2. Bridge receives `send_prompt`, runs its capture-before-send gate, and replies with a lightweight ack carrying its verdict:
   - **fresh-turn** → ack `prompt_received { fresh: true }` → client sets `status: "sent"` (State 2). Bubble proceeds to confirm on the eventual user `message_start`.
   - **mid-turn** (raced into streaming) → ack `prompt_received { fresh: false }` → client **drops** `pendingPrompt`; the authoritative `queue_update` chip takes over. No double render.

This makes the bridge the single arbiter and collapses the same-tick race into a deterministic ack branch.

## Decision 3 — Two-state vs three-state visual (does "sent" need a real ack?)

| | 2-state | 3-state (selected) |
|---|---|---|
| States | sending → confirmed | sending → sent → confirmed |
| "sent" signal | n/a | bridge `prompt_received` ack |
| Server/protocol change | none | small: one ack message |
| Honesty on slow/dropped link | bubble spins until confirm/timeout | "sent" reflects real receipt; distinguishes "in flight" from "received, awaiting echo" |
| Same-tick race handling | needs separate solution | **handled by the same ack** (Decision 2) |

**Decision: 3-state**, because the ack required for the honest "sent" indicator is the *same* ack that resolves the same-tick race (Decision 2). One bridge message buys both the progress fidelity and the race fix. A cosmetic timer-based "sent" was rejected: it would lie on a dropped connection and would not resolve the race.

If implementation reveals the bridge ack is disproportionately costly, the fallback is 2-state (sending → confirmed) **plus** keeping the bridge ack purely for the race verdict (drop-vs-keep), not for visual progression. This is the documented degrade path, not the default.

## Decision 4 — Visual: zero-layout-shift across states

All three states render the **same** bubble box: `flex justify-end`, `max-w-[80%] rounded-xl border-l-2 border-l-blue-400 px-4 py-2`. Only opacity and the trailing status chip change. State transitions:

- `sending`: `opacity-60`, edge-pulse animation, faint left-to-right sweep (clipped to the bubble via `overflow:hidden` on the bubble, not the pseudo-element — see mockup fix), spinner + "sending".
- `sent`: drop opacity/pulse/sweep classes, full `bg-blue-500/10 border-blue-500/20`, spinner → green check, "sent".
- `confirmed`: the real user `message_start` arrives; reducer clears `pendingPrompt`; the server-sourced bubble renders in identical geometry → the chip simply fades. No re-layout, no flicker.

Reference: `openspec/changes/optimistic-prompt-progress/mockup/index.html`.

## State machine

```
   send (client snapshot: idle)
        │
        ▼
   pendingPrompt{status:"sending"}        ── render: dimmed bubble + spinner
        │
        ├── bridge ack {fresh:false} ──▶ drop pendingPrompt ──▶ queue chip (mid-turn-prompt-queue)
        │
        ├── bridge ack {fresh:true} ───▶ status:"sent"        ── render: full bubble + green check
        │        │
        │        ▼
        │   user message_start ─────────▶ clear pendingPrompt ──▶ server bubble (confirmed)
        │
        ├── abort / turn-end (reducer) ─▶ clear pendingPrompt (existing 6 sites)
        │
        └── 30s no confirm ────────────▶ usePendingPromptTimeout clears + surfaces error (unchanged)
```

## Open questions

1. **Does the bridge already expose a per-send ack?** If `send_prompt` handling can cheaply emit `prompt_received` with the capture-before-send verdict, Decision 2/3 is low-cost. If not, scope includes a new bridge→server→browser message. (Investigate `packages/extension/src/bridge.ts` send path + `browser-protocol.ts`.)
2. **`handleSendPromptToSession` (card/board quick-send) vs `handleSend` (composer)** — both must apply the idle guard. Quick-send from a non-selected session means the client may not hold fresh `state` for that session; the bridge ack (Decision 2) covers this since the verdict is bridge-side, not client-snapshot-side.
3. **Multiple rapid idle sends** — out of scope here (idle send starts a turn, so a second idle send is by definition mid-turn → queue). The "multiple in-flight pending" v1 requirement is superseded by idle-scoping; the spec delta removes it.
